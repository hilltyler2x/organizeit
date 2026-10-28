import Foundation
import Photos
import UIKit

// Keeps sorting going after the app is closed, past the half minute iOS gives a closed app.
// In that half minute the waiting photos are prepared and handed to iOS's background transfer
// service, which sends them to /api/classify by itself while OrganizeIt is suspended. When
// they are all answered iOS wakes the app briefly: the answers are kept for the app, and
// while the phone is charging the next photos are handed over.
//
// iOS still decides when the transfers run (they wait for a connection, and slow down if the
// app is woken very often), and swiping the app away in the app switcher cancels them.

final class BackgroundUploads: NSObject, URLSessionDataDelegate {
    static let shared = BackgroundUploads()

    /// Most photos handed over at once: on battery that's all until the phone charges.
    static let chargingRound = 200

    let identifier = (Bundle.main.bundleIdentifier ?? "com.organizeit.app") + ".uploads"

    private let lock = NSLock()
    private var received: [Int: Data] = [:]
    private var finishEvents: (() -> Void)?
    private let defaults = UserDefaults.standard
    private let sortedKey = "organizeit.uploads.sorted"
    private let stoppedKey = "organizeit.uploads.stopped"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: identifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsConstrainedNetworkAccess = false // Low Data Mode
        config.timeoutIntervalForResource = 24 * 60 * 60
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private lazy var folder: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("OrganizeIt-uploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    /// At launch, so answers that arrived while the app was gone are delivered.
    func reconnect() {
        _ = session
    }

    /// iOS woke the app because the handed-over photos are all answered.
    func handleEvents(_ identifier: String, completion: @escaping () -> Void) -> Bool {
        guard identifier == self.identifier else { return false }
        lock.lock()
        finishEvents = completion
        lock.unlock()
        _ = session
        return true
    }

    /// Photos handed over and not answered yet.
    func inFlight() async -> Set<String> {
        let tasks = await session.allTasks
        return Set(tasks.compactMap { $0.taskDescription.flatMap(Self.parse)?.id })
    }

    /// The app is open again and sorts by itself, so the ones still waiting are taken back.
    func cancelAll() {
        session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
    }

    /// Prepares up to `limit` waiting photos and hands them to iOS to send. Returns how many
    /// were handed over (0 when none are waiting, or some are still on their way).
    func handOff(limit: Int, shouldStop: () -> Bool) async -> Int {
        let sorter = BackgroundSorter.shared
        guard await session.allTasks.isEmpty else { return 0 }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited,
              let config = sorter.store.load().config, !config.apiUrl.isEmpty else { return 0 }
        let power = await BatteryPower.now()
        if power.shouldPause { return 0 }
        var skip = Set(sorter.store.load().results.map { $0.asset.id })
        let (assets, _) = sorter.nextBatch(config, skipping: &skip, size: limit)
        if assets.isEmpty { return 0 }
        defaults.set(0, forKey: sortedKey)
        defaults.set(false, forKey: stoppedKey)
        var handed = 0
        for asset in assets {
            if shouldStop() { break }
            let prepared = await sorter.classifyRequest(asset, config: config, categories: config.categories, download: power.charging)
            guard case .success(var request) = prepared, let body = request.httpBody else { continue }
            let file = folder.appendingPathComponent(UUID().uuidString + ".json")
            guard (try? body.write(to: file)) != nil else { continue }
            request.httpBody = nil
            let task = session.uploadTask(with: request, fromFile: file)
            task.taskDescription = asset.localIdentifier + "\n" + file.lastPathComponent
            task.resume()
            handed += 1
        }
        return handed
    }

    /// How many photos still wait to be sorted.
    private func waiting() async -> Int {
        let store = BackgroundSorter.shared.store
        guard let config = store.load().config else { return 0 }
        var skip = Set(store.load().results.map { $0.asset.id }).union(await inFlight())
        return BackgroundSorter.shared.nextBatch(config, skipping: &skip, size: 1).1
    }

    private static func parse(_ description: String) -> (id: String, file: String)? {
        let parts = description.components(separatedBy: "\n")
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        received[dataTask.taskIdentifier, default: Data()].append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let data = received.removeValue(forKey: task.taskIdentifier) ?? Data()
        lock.unlock()
        guard let parsed = task.taskDescription.flatMap(Self.parse) else { return }
        let id = parsed.id
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(parsed.file))
        guard error == nil else { return } // cancelled or failed: left for the next run or the app
        let code = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        switch BackgroundSorter.answer(code, data) {
        case .success(let result):
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return }
            BackgroundSorter.shared.store.add(BackgroundResult(asset: DeviceAsset(asset), result: result))
            lock.lock()
            defaults.set(defaults.integer(forKey: sortedKey) + 1, forKey: sortedKey)
            lock.unlock()
        case .failure(.permanent):
            defaults.set(true, forKey: stoppedKey)
        default:
            break // left for the next run or the app, which retries and shows errors
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let completion = finishEvents
        finishEvents = nil
        lock.unlock()
        DispatchQueue.main.async {
            final class Holder { var id = UIBackgroundTaskIdentifier.invalid }
            let holder = Holder()
            let done = {
                DispatchQueue.main.async {
                    completion?()
                    if holder.id != .invalid { UIApplication.shared.endBackgroundTask(holder.id) }
                    holder.id = .invalid
                }
            }
            let work = Task {
                await self.nextRound()
                done()
            }
            holder.id = UIApplication.shared.beginBackgroundTask(withName: "Hand photos to iOS") {
                work.cancel()
                done()
            }
        }
    }

    /// After a round is answered: logs it, and hands over the next photos while charging.
    private func nextRound() async {
        let sorted = defaults.integer(forKey: sortedKey)
        let done = sorted == 0 ? "" : "Sorted \(sorted) photo\(sorted == 1 ? "" : "s") in the background. "
        if defaults.bool(forKey: stoppedKey) {
            BackgroundSortLog.note(done + "Stopped: the server turned the photos down (subscription, passcode or AI key). Open OrganizeIt to see why.")
            return
        }
        if BackgroundSorter.shared.isAppActive { return }
        let power = await BatteryPower.now()
        if !power.charging {
            let left = await waiting()
            BackgroundSortLog.note(done + (left > 0
                ? "The rest will be sorted while the phone charges, or when you open OrganizeIt."
                : "All caught up."))
            return
        }
        let handed = await handOff(limit: Self.chargingRound, shouldStop: { Task.isCancelled })
        BackgroundSortLog.note(done + (handed > 0
            ? "Sending the next \(handed) to sort while the phone charges."
            : "All caught up."))
    }
}
