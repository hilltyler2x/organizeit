import BackgroundTasks
import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

// Sorts photos while OrganizeIt is closed. The app hands over a snapshot (server address,
// passcode, categories, lessons, which photos are waiting) through BackgroundSortPlugin; this
// sorts from that snapshot with plain Swift, since the web view isn't running, and keeps each
// answer on disk until the app takes it back and files it.
//
// What iOS allows:
// - iOS 26 and later: once there are photos waiting, a continued processing task is started
//   while the app is open, so sorting carries on after it is closed, with progress shown by
//   the system. The person can stop it from there.
// - Any iOS: about 30 more seconds when the app is closed (a background task), plus
//   background refresh and processing tasks that iOS runs when it chooses (often overnight
//   while charging) to sort photos taken since. Nothing can run the instant a photo is taken,
//   and nothing runs after the app is swiped away in the app switcher until iOS relaunches it.
//
// Saving battery (BatteryPower): on battery, a background run sorts at most 100 photos, gives
// up on an unreachable server after 3 minutes, and doesn't download photos kept in iCloud. In
// Low Power Mode or under 20% (and not plugged in) it doesn't sort at all. A big backlog is
// left for the processing task, which only runs while the phone charges.

struct DeviceAsset: Codable {
    var id: String
    var fileName: String
    var width: Int
    var height: Int
    var createdAt: Double
    var bytes: Int64
    var mimeType: String
    var isScreenshot: Bool
    // Optional so answers saved before videos were sorted still load.
    var isVideo: Bool?
    var durationMs: Double?

    init(_ asset: PHAsset) {
        let video = asset.mediaType == .video
        let resources = PHAssetResource.assetResources(for: asset)
        let original = resources.first { $0.type == (video ? .video : .photo) } ?? resources.first
        var mimeType = video ? "video/quicktime" : "image/jpeg"
        if let uti = original?.uniformTypeIdentifier, let type = UTType(uti), let mime = type.preferredMIMEType {
            mimeType = mime
        }
        id = asset.localIdentifier
        fileName = original?.originalFilename ?? ""
        width = asset.pixelWidth
        height = asset.pixelHeight
        createdAt = (asset.creationDate ?? Date()).timeIntervalSince1970 * 1000
        bytes = (original?.value(forKey: "fileSize") as? NSNumber)?.int64Value ?? 0
        self.mimeType = mimeType
        isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)
        if video {
            isVideo = true
            durationMs = (asset.duration * 1000).rounded()
        }
    }

    var dictionary: [String: Any] {
        var out: [String: Any] = [
            "id": id, "fileName": fileName, "width": width, "height": height, "createdAt": createdAt,
            "bytes": bytes, "mimeType": mimeType, "isScreenshot": isScreenshot
        ]
        if isVideo == true {
            out["isVideo"] = true
            out["durationMs"] = durationMs ?? 0
        }
        return out
    }
}

struct CategoryName: Codable, Equatable {
    var section: String
    var name: String
}

struct LessonForPrompt: Codable {
    var label: String
    var section: String
    var category: String
    var wrong: String?
}

struct Classification: Codable {
    var section: String
    var category: String
    var label: String
    var confidence: Double
}

/// Matches src/lib/backgroundSort.ts.
struct BackgroundSortConfig: Codable {
    var apiUrl: String
    var passcode: String
    var categories: [CategoryName]
    var lessons: [LessonForPrompt]
    /// Photos waiting to be sorted, newest first.
    var queued: [String]
    /// Creation time (ms) of the newest photo the app knows about; anything newer is new.
    var knownUpTo: Double
}

struct BackgroundResult: Codable {
    var asset: DeviceAsset
    var result: Classification
}

/// The snapshot and the answers, in one small file the app and background launches share.
final class BackgroundSortStore {
    private struct Contents: Codable {
        var config: BackgroundSortConfig?
        var results: [BackgroundResult] = []
    }

    private let lock = NSLock()
    private let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OrganizeIt", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("background-sort.json")
    }()

    private func read() -> Contents {
        guard let data = try? Data(contentsOf: url), let contents = try? JSONDecoder().decode(Contents.self, from: data) else {
            return Contents()
        }
        return contents
    }

    private func write(_ contents: Contents) {
        guard let data = try? JSONEncoder().encode(contents) else { return }
        // Readable after the first unlock, so background tasks work while the phone is locked.
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func update<T>(_ body: (inout Contents) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        var contents = read()
        let value = body(&contents)
        write(contents)
        return value
    }

    func load() -> (config: BackgroundSortConfig?, results: [BackgroundResult]) {
        lock.lock()
        defer { lock.unlock() }
        let contents = read()
        return (contents.config, contents.results)
    }

    func save(config: BackgroundSortConfig) {
        update { $0.config = config }
    }

    func add(_ result: BackgroundResult) {
        update { contents in
            contents.results.removeAll { $0.asset.id == result.asset.id }
            contents.results.append(result)
        }
    }

    /// Hands every saved answer to the app and forgets them.
    func takeResults() -> [BackgroundResult] {
        update { contents in
            let results = contents.results
            contents.results = []
            return results
        }
    }
}

/// What background sorting last did, so the app can show it. Kept in UserDefaults.
struct BackgroundSortLog {
    private static let defaults = UserDefaults.standard

    static func note(_ message: String) {
        NSLog("OrganizeIt background sort: \(message)")
        defaults.set(message, forKey: "organizeit.background.last")
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: "organizeit.background.lastAt")
    }

    static var last: (message: String, at: Double)? {
        guard let message = defaults.string(forKey: "organizeit.background.last") else { return nil }
        return (message, defaults.double(forKey: "organizeit.background.lastAt"))
    }
}

/// What the battery allows background sorting to do right now.
struct BatteryPower {
    var charging: Bool
    /// 0...1, or -1 when iOS doesn't say.
    var level: Float
    var lowPowerMode: Bool

    /// Most photos a background run sorts on battery; the rest wait for the phone to charge.
    static let batteryLimit = 100

    /// Low Power Mode, or under 20%, and not plugged in: background sorting waits.
    var shouldPause: Bool { !charging && (lowPowerMode || (level >= 0 && level < 0.2)) }

    /// Call on the main thread, like the rest of UIDevice.
    static func read() -> BatteryPower {
        let device = UIDevice.current
        device.isBatteryMonitoringEnabled = true
        return BatteryPower(
            charging: device.batteryState == .charging || device.batteryState == .full,
            level: device.batteryLevel,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled
        )
    }

    static func now() async -> BatteryPower {
        await MainActor.run { read() }
    }
}

public final class BackgroundSorter {
    public static let shared = BackgroundSorter()

    let store = BackgroundSortStore()

    private let bundleId = Bundle.main.bundleIdentifier ?? "com.organizeit.app"
    private var refreshId: String { "\(bundleId).refresh" }
    private var processingId: String { "\(bundleId).sort" }
    private var continuedPrefix: String { "\(bundleId).continue" }

    private let lock = NSLock()
    private var running = false
    private var active = true
    private var continuedTask: AnyObject?
    private var continuedTotal: Int64 = 0
    /// When starting the continued task last failed; not retried for a minute after.
    private var continuedFailedAt: Date?
    /// The battery as last read, for code that can't wait on the main thread.
    private var power = BatteryPower(charging: false, level: -1, lowPowerMode: false)
    /// How many photos the last run sorted, for the log.
    private var lastRunSorted = 0

    /// Logs how the last run ended, with how many photos it sorted.
    private func noteRun(_ ending: String) {
        let n = lastRunSorted
        BackgroundSortLog.note(n == 0 ? ending : "Sorted \(n) photo\(n == 1 ? "" : "s") in the background. \(ending)")
    }

    /// True while the app is on screen; the app sorts by itself then.
    var isAppActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return active
    }

    private func setAppActive(_ value: Bool) {
        lock.lock()
        active = value
        lock.unlock()
    }

    /// Call from application(_:didFinishLaunchingWithOptions:). iOS requires background tasks
    /// to be registered before launch finishes.
    public func registerTasks() {
        setAppActive(UIApplication.shared.applicationState != .background)
        notePower(BatteryPower.read())
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshId, using: nil) { [weak self] task in
            self?.runScheduled(task)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingId, using: nil) { [weak self] task in
            self?.runScheduled(task)
        }
        // The iOS 26 continued task is registered under its own identifier right before it is
        // submitted (queueChanged): iOS refuses a handler registered for the wildcard itself.
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.setAppActive(true)
        }
        for name in [UIDevice.batteryStateDidChangeNotification, UIDevice.batteryLevelDidChangeNotification, Notification.Name.NSProcessInfoPowerStateDidChange] {
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.notePower(BatteryPower.read())
            }
        }
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.setAppActive(false)
            self.scheduleBackgroundTasks()
            self.keepGoingAfterClose()
        }
    }

    private func notePower(_ value: BatteryPower) {
        lock.lock()
        power = value
        lock.unlock()
    }

    private var lastPower: BatteryPower {
        lock.lock()
        defer { lock.unlock() }
        return power
    }

    /// Asks iOS to wake the app now and then to sort photos taken since it was last open: a
    /// short refresh about hourly for new photos, and the long catch-up only while charging.
    func scheduleBackgroundTasks() {
        guard store.load().config != nil else { return }
        let refresh = BGAppRefreshTaskRequest(identifier: refreshId)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(refresh)
        let processing = BGProcessingTaskRequest(identifier: processingId)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = true
        processing.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(processing)
    }

    /// Called whenever the app sends a new snapshot. On iOS 26+, starts the continued task
    /// that carries sorting on after the app is closed, or updates its progress.
    func queueChanged(waiting: Int) {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            lock.lock()
            let task = continuedTask as? BGContinuedProcessingTask
            let alreadyStarted = continuedTask != nil
            lock.unlock()
            if let task = task {
                report(task, waiting: waiting)
                return
            }
            guard waiting > 0, !alreadyStarted, isAppActive else { return }
            // Low Power Mode or a low battery: leave it for when the phone charges.
            if lastPower.shouldPause { return }
            if let failed = continuedFailedAt, Date().timeIntervalSince(failed) < 60 { return }
            // Info.plist permits "<bundle id>.continue.*"; each request gets a fresh identifier with
            // its own handler, since a handler can't be registered for the wildcard and an
            // identifier can only be registered once.
            let identifier = "\(continuedPrefix).\(UUID().uuidString)"
            let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { [weak self] task in
                guard let task = task as? BGContinuedProcessingTask else { return task.setTaskCompleted(success: false) }
                self?.runContinued(task)
            }
            guard registered else {
                continuedFailedAt = Date()
                BackgroundSortLog.note("iOS wouldn't let OrganizeIt sort in the background (task not permitted).")
                return
            }
            let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: "Sorting photos", subtitle: "\(waiting) to go")
            request.strategy = .fail // start now or not at all, so a stale request never blocks the next
            // Marked before submitting: iOS may start the task (and set the real one) right away.
            lock.lock()
            continuedTask = NSNull()
            lock.unlock()
            do {
                try BGTaskScheduler.shared.submit(request)
            } catch {
                lock.lock()
                if continuedTask is NSNull { continuedTask = nil }
                continuedFailedAt = Date()
                lock.unlock()
                BackgroundSortLog.note("iOS wouldn't start sorting in the background (\(error.localizedDescription)).")
            }
        }
        #endif
    }

    /// What the app shows about background sorting on this phone.
    func status() -> [String: Any] {
        var out: [String: Any] = [:]
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available: out["backgroundRefresh"] = "on"
        case .denied: out["backgroundRefresh"] = "off"
        default: out["backgroundRefresh"] = "restricted"
        }
        var continued = false
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { continued = true }
        #endif
        out["keepsGoingAfterClose"] = continued
        if let last = BackgroundSortLog.last {
            out["last"] = last.message
            out["lastAt"] = last.at
        }
        return out
    }

    // MARK: - Running

    enum Outcome {
        /// Nothing is left to sort.
        case finished
        /// Asked to stop (time is up, or the app came back).
        case stopped
        /// Can't sort right now: no photo access, wrong passcode, no AI key, or the server
        /// stayed unreachable after several tries.
        case blocked
        /// Another run is already sorting.
        case busy
        /// Stopped to save battery; carries on once the phone charges.
        case paused
    }

    private func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if running { return false }
        running = true
        return true
    }

    private func release() {
        lock.lock()
        running = false
        lock.unlock()
    }

    /// Sorts waiting photos, a few at a time, until none are left or `shouldStop` says so.
    /// `progress` is told how many are still waiting after each photo. A dropped connection, a
    /// sleeping server or a busy AI is waited out with growing pauses, as the app's own queue
    /// does, rather than ending the run.
    func run(shouldStop: @escaping () -> Bool, progress: ((Int) -> Void)? = nil) async -> Outcome {
        guard claim() else { return .busy }
        defer { release() }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            lastRunSorted = 0
            noteRun("Stopped: OrganizeIt doesn't have access to Photos.")
            return .blocked
        }
        guard let first = store.load().config, !first.apiUrl.isEmpty else { return .blocked }
        var categories = first.categories
        var skip = Set<String>()
        var tries: [String: Int] = [:]
        var pause: UInt64 = 0
        var waitedSince: Date?
        var sorted = 0
        defer { lastRunSorted = sorted }
        while !shouldStop() {
            let power = await BatteryPower.now()
            notePower(power)
            if power.shouldPause {
                lastRunSorted = sorted
                noteRun(power.lowPowerMode
                    ? "Paused to save battery (Low Power Mode). Sorting carries on when the phone charges or you open OrganizeIt."
                    : "Paused to save battery (under 20%). Sorting carries on when the phone charges or you open OrganizeIt.")
                return .paused
            }
            if !power.charging && sorted >= BatteryPower.batteryLimit {
                lastRunSorted = sorted
                noteRun("The rest will be sorted while the phone charges, or when you open OrganizeIt.")
                return .paused
            }
            // Re-read each round: the app may have sent a newer snapshot.
            let (stored, results) = store.load()
            guard let config = stored else { return .blocked }
            for c in config.categories where !categories.contains(c) { categories.append(c) }
            skip.formUnion(results.map { $0.asset.id })
            let (batch, waiting) = nextBatch(config, skipping: &skip, size: 3)
            if batch.isEmpty { return .finished }
            var left = waiting
            var problem: SortError?
            await withTaskGroup(of: (PHAsset, Result<Classification, SortError>).self) { group in
                for asset in batch {
                    let cats = categories
                    group.addTask { (asset, await self.classify(asset, config: config, categories: cats, download: power.charging)) }
                }
                for await (asset, outcome) in group {
                    let id = asset.localIdentifier
                    switch outcome {
                    case .success(let result):
                        skip.insert(id)
                        store.add(BackgroundResult(asset: DeviceAsset(asset), result: result))
                        sorted += 1
                        // Same threshold as REVIEW_BELOW in src/core/library.ts.
                        let named = CategoryName(section: result.section, name: result.category)
                        if result.confidence >= 0.6 && !categories.contains(named) { categories.append(named) }
                        left = max(0, left - 1)
                        progress?(left)
                    case .failure(.skip):
                        skip.insert(id) // left for the app, which retries and shows errors
                    case .failure(.retry):
                        tries[id, default: 0] += 1
                        if tries[id]! >= 4 { skip.insert(id) }
                        if problem == nil { problem = .retry }
                    case .failure(.offline):
                        if problem != .permanent { problem = .offline }
                    case .failure(.permanent):
                        problem = .permanent
                    }
                }
            }
            switch problem {
            case .permanent?:
                lastRunSorted = sorted
                noteRun("Stopped: the server turned the photos down (passcode or AI key). Open OrganizeIt to fix it.")
                return .blocked
            case .offline?, .retry?:
                // Give the server (which can take a minute to wake) or the network time to come back.
                // On battery, a few minutes of waiting with the radio on is all it's worth.
                let since = waitedSince ?? Date()
                waitedSince = since
                let minutes = power.charging ? 15 : 3
                if Date().timeIntervalSince(since) > Double(minutes * 60) {
                    lastRunSorted = sorted
                    noteRun(problem == .offline
                        ? "Stopped: couldn't reach the sorting server for \(minutes) minutes."
                        : "Stopped: the sorting server stayed busy for \(minutes) minutes.")
                    return .blocked
                }
                pause = min(max(pause * 2, 5), 60)
                for _ in 0..<pause where !shouldStop() {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            default:
                pause = 0
                waitedSince = nil
            }
        }
        return .stopped
    }

    /// The next photos to sort: ones the app queued, then ones taken since it was last open.
    private func nextBatch(_ config: BackgroundSortConfig, skipping skip: inout Set<String>, size: Int) -> ([PHAsset], Int) {
        let queued = config.queued.filter { [skip] in !skip.contains($0) }
        let queuedSet = Set(config.queued)
        let options = VideoFrames.mediaOptions(NSPredicate(format: "creationDate > %@", Date(timeIntervalSince1970: config.knownUpTo / 1000) as NSDate))
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 500
        var fresh: [PHAsset] = []
        let skipped = skip
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            if !skipped.contains(asset.localIdentifier) && !queuedSet.contains(asset.localIdentifier) { fresh.append(asset) }
        }
        var batch: [PHAsset] = []
        if !queued.isEmpty {
            let wanted = Array(queued.prefix(size * 2))
            let found = PHAsset.fetchAssets(withLocalIdentifiers: wanted, options: nil)
            var byId: [String: PHAsset] = [:]
            found.enumerateObjects { asset, _, _ in byId[asset.localIdentifier] = asset }
            for id in wanted where byId[id] == nil { skip.insert(id) } // deleted since
            batch = wanted.compactMap { byId[$0] }.prefix(size).map { $0 }
        }
        for asset in fresh where batch.count < size { batch.append(asset) }
        // Every queued photo in this round was deleted: look again past them.
        if batch.isEmpty && queued.count > 0 { return nextBatch(config, skipping: &skip, size: size) }
        return (batch, queued.count + fresh.count)
    }

    enum SortError: Error {
        /// Wrong passcode or no AI key: retrying won't help.
        case permanent
        /// No connection, or the server is asleep or unreachable.
        case offline
        /// The server or AI is busy or had a hiccup: try this photo again shortly.
        case retry
        /// This photo can't be sorted here (unreadable image, rejected request).
        case skip
    }

    /// `download`: whether a photo kept only in iCloud may be downloaded (only while charging).
    private func classify(_ asset: PHAsset, config: BackgroundSortConfig, categories: [CategoryName], download: Bool) async -> Result<Classification, SortError> {
        let isVideo = asset.mediaType == .video
        // A video is sent as four frames from across it in one image.
        let picture = isVideo
            ? await VideoFrames.sheet(for: asset, maxSide: 768, quality: 0.8, download: download)?.0
            : await image(asset, maxSide: 768, quality: 0.8, download: download)
        guard let jpeg = picture else { return .failure(.skip) }
        let info = DeviceAsset(asset)
        var body: [String: Any] = [
            "image": jpeg.base64EncodedString(),
            "mediaType": "image/jpeg",
            "fileName": String(info.fileName.prefix(300)),
            "width": info.width,
            "height": info.height,
            "isScreenshot": info.isScreenshot,
            "categories": categories.map { ["section": $0.section, "name": $0.name] },
            "lessons": config.lessons.map { lesson -> [String: Any] in
                var l: [String: Any] = ["label": lesson.label, "section": lesson.section, "category": lesson.category]
                if let wrong = lesson.wrong { l["wrong"] = wrong }
                return l
            }
        ]
        if isVideo {
            body["isVideo"] = true
            body["durationSec"] = Int(asset.duration.rounded())
        }
        guard let url = URL(string: config.apiUrl + "/api/classify"),
              let payload = try? JSONSerialization.data(withJSONObject: body) else { return .failure(.permanent) }
        var request = URLRequest(url: url, timeoutInterval: 90) // the free server can take a minute to wake
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(config.passcode, forHTTPHeaderField: "x-organizeit-passcode")
        request.httpBody = payload
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200, let result = try? JSONDecoder().decode(Classification.self, from: data) { return .success(result) }
            switch code {
            case 401, 503: return .failure(.permanent) // wrong passcode, or the server has no working AI key
            case 429, 500...599: return .failure(.retry)
            default: return .failure(.skip)
            }
        } catch {
            return .failure(.offline) // no connection, server asleep, or cancelled
        }
    }

    private func image(_ asset: PHAsset, maxSide: CGFloat, quality: CGFloat, download: Bool) async -> Data? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let scale = min(1, maxSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
                let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
                let options = PHImageRequestOptions()
                options.isSynchronous = true
                options.deliveryMode = .highQualityFormat
                options.resizeMode = .exact
                options.isNetworkAccessAllowed = download
                var data: Data?
                PHImageManager.default().requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, _ in
                    data = image?.jpegData(compressionQuality: quality)
                }
                continuation.resume(returning: data)
            }
        }
    }

    // MARK: - The ways iOS lets it run

    /// Background refresh and processing tasks: iOS picks the time.
    private func runScheduled(_ task: BGTask) {
        scheduleBackgroundTasks()
        let work = Task {
            let outcome = await self.run(shouldStop: { Task.isCancelled })
            switch outcome {
            case .finished: self.noteRun("All caught up.")
            case .stopped: self.noteRun("iOS ended this background run; it picks when the next one is.")
            default: break // .paused and .blocked log their own reason
            }
            task.setTaskCompleted(success: outcome != .blocked)
        }
        task.expirationHandler = { work.cancel() }
    }

    /// The extra half minute or so iOS gives an app that was just closed. Skipped when the
    /// continued task (iOS 26+) is already carrying on.
    private func keepGoingAfterClose() {
        lock.lock()
        let continuing = continuedTask != nil
        lock.unlock()
        guard !continuing, let config = store.load().config, !config.queued.isEmpty else { return }
        final class Holder { var id = UIBackgroundTaskIdentifier.invalid }
        let holder = Holder()
        let finish = {
            DispatchQueue.main.async {
                guard holder.id != .invalid else { return }
                UIApplication.shared.endBackgroundTask(holder.id)
                holder.id = .invalid
            }
        }
        let work = Task {
            let outcome = await self.run(shouldStop: { Task.isCancelled || self.isAppActive })
            if outcome == .finished { self.noteRun("All caught up.") }
            if outcome == .stopped && !self.isAppActive {
                self.noteRun("iOS paused sorting about 30 seconds after the app was closed.")
            }
            finish()
        }
        holder.id = UIApplication.shared.beginBackgroundTask(withName: "Sort photos") {
            work.cancel()
            finish()
        }
    }

    #if compiler(>=6.2)
    @available(iOS 26.0, *)
    private func report(_ task: BGContinuedProcessingTask, waiting: Int) {
        lock.lock()
        continuedTotal = max(continuedTotal, Int64(task.progress.completedUnitCount) + Int64(waiting))
        let total = continuedTotal
        lock.unlock()
        task.progress.totalUnitCount = max(total, 1)
        task.progress.completedUnitCount = total - Int64(waiting)
        task.updateTitle("Sorting photos", subtitle: waiting == 1 ? "1 to go" : "\(waiting) to go")
    }

    /// iOS 26+: keeps sorting after the app is closed, with progress shown by the system.
    /// While the app is open it sorts by itself, so this only follows along.
    @available(iOS 26.0, *)
    private func runContinued(_ task: BGContinuedProcessingTask) {
        lock.lock()
        continuedTask = task
        continuedTotal = 0
        lock.unlock()
        BackgroundSortLog.note("Sorting will carry on after you close the app.")
        let work = Task {
            var success = true
            // Once everything is sorted with the app closed, keep watching a few minutes for
            // photos taken in the meantime, so they're sorted without waiting for the next
            // time iOS wakes the app.
            var watchUntil: Date?
            while !Task.isCancelled {
                if self.isAppActive {
                    let waiting = self.store.load().config?.queued.count ?? 0
                    self.report(task, waiting: waiting)
                    if waiting == 0 { break }
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    continue
                }
                let outcome = await self.run(shouldStop: { Task.isCancelled || self.isAppActive }) { waiting in
                    self.report(task, waiting: waiting)
                }
                if outcome == .finished {
                    if self.isAppActive { continue }
                    // Watching for new photos keeps the phone awake: only worth it while charging.
                    if !self.lastPower.charging { self.noteRun("All caught up."); break }
                    let until = watchUntil ?? Date(timeIntervalSinceNow: 5 * 60)
                    watchUntil = until
                    if Date() >= until { self.noteRun("All caught up."); break }
                    if self.lastRunSorted > 0 { watchUntil = Date(timeIntervalSinceNow: 5 * 60) } // new photos came in
                    task.updateTitle("Sorting photos", subtitle: "All sorted · watching for new photos")
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    continue
                }
                if outcome == .blocked { success = false; break }
                if outcome == .paused { break }
                if outcome == .busy { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            }
            self.lock.lock()
            self.continuedTask = nil
            self.lock.unlock()
            task.setTaskCompleted(success: success)
        }
        task.expirationHandler = {
            BackgroundSortLog.note("Background sorting was stopped (from the progress indicator, or by iOS).")
            work.cancel()
        }
    }
    #endif
}
