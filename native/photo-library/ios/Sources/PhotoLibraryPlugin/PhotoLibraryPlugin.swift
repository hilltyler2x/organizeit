import Capacitor
import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

/// Gives OrganizeIt read, delete, album, copy and share access to the iOS Photos library. Photos are read in
/// place; nothing is copied out except small JPEG previews requested by the app.
@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin, PHPhotoLibraryChangeObserver {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addToAlbum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareImage", returnType: CAPPluginReturnPromise)
    ]

    /// All images and videos, kept to tell ones being added or removed apart from other library changes.
    private var watched: PHFetchResult<PHAsset>?

    override public func load() {
        watchLibrary()
    }

    deinit {
        if watched != nil { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    }

    /// Tells the app (event "libraryChanged") the moment a photo is added to or removed from the
    /// library while the app is running, so a new photo is sorted right away. Starts once
    /// access is granted; registering earlier could bring up the permission prompt.
    private func watchLibrary() {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard watched == nil, status == .authorized || status == .limited else { return }
        watched = PHAsset.fetchAssets(with: VideoFrames.mediaOptions())
        PHPhotoLibrary.shared().register(self)
    }

    public func photoLibraryDidChange(_ changeInstance: PHChange) {
        DispatchQueue.main.async { // `watched` is only touched on the main queue
            guard let current = self.watched, let details = changeInstance.changeDetails(for: current) else { return }
            self.watched = details.fetchResultAfterChanges
            let inserted = details.insertedObjects.count
            if inserted > 0 || details.removedObjects.count > 0 {
                self.notifyListeners("libraryChanged", data: ["added": inserted])
            }
        }
    }

    private func statusName(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc func checkPermission(_ call: CAPPluginCall) {
        call.resolve(["status": statusName(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            DispatchQueue.main.async { self.watchLibrary() }
            call.resolve(["status": self.statusName(status)])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    /// Pages through every photo and video in the library, oldest first.
    @objc func list(_ call: CAPPluginCall) {
        let offset = max(0, call.getInt("offset", 0))
        let limit = max(1, min(call.getInt("limit", 500), 2000))
        DispatchQueue.global(qos: .userInitiated).async {
            let options = VideoFrames.mediaOptions()
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            let result = PHAsset.fetchAssets(with: options)
            let end = min(result.count, offset + limit)
            var assets: [[String: Any]] = []
            if offset < end {
                for index in offset..<end {
                    assets.append(self.describe(result.object(at: index)))
                }
            }
            var response: [String: Any] = ["assets": assets, "total": result.count]
            response["nextOffset"] = end < result.count ? end : NSNull()
            call.resolve(response)
        }
    }

    private func describe(_ asset: PHAsset) -> [String: Any] {
        DeviceAsset(asset).dictionary
    }

    /// Returns a JPEG copy of a photo scaled so its longest side is at most `maxSide`. For a
    /// video it is the opening frame or, with `frames`, four frames from across it in a grid.
    @objc func getImage(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("Missing id") }
        let maxSide = CGFloat(max(64, call.getInt("maxSide", 1024)))
        let quality = CGFloat(call.getDouble("quality", 0.8))
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            return call.reject("Photo not found", "NOT_FOUND")
        }
        if asset.mediaType == .video && call.getBool("frames", false) {
            Task {
                guard let sheet = await VideoFrames.sheet(for: asset, maxSide: maxSide, quality: quality, download: true) else {
                    return call.reject("Could not load video")
                }
                call.resolve(["data": sheet.0.base64EncodedString(), "width": Int(sheet.1.width), "height": Int(sheet.1.height)])
            }
            return
        }
        let scale = min(1, maxSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
        let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        options.isNetworkAccessAllowed = true // photos kept in iCloud are downloaded at preview size
        PHImageManager.default().requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, _ in
            guard let image = image, let data = image.jpegData(compressionQuality: quality) else {
                return call.reject("Could not load photo")
            }
            call.resolve([
                "data": data.base64EncodedString(),
                "width": Int(image.size.width * image.scale),
                "height": Int(image.size.height * image.scale)
            ])
        }
    }

    /// Copies a video somewhere the app's web view can play it from, downloading it from iCloud
    /// if needed, and returns that file's path.
    @objc func getVideo(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("Missing id") }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject, asset.mediaType == .video else {
            return call.reject("That video is no longer on this phone", "NOT_FOUND")
        }
        VideoFrames.playableFile(for: asset) { result in
            switch result {
            case .success(let file): call.resolve(["path": file.path])
            case .failure(let error): call.reject("Could not load video: \(error.localizedDescription)")
            }
        }
    }

    /// Deletes photos from the library. iOS shows its own confirmation and moves them to
    /// Recently Deleted. Resolves with deleted: false if the person cancels.
    @objc func deleteAssets(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        if assets.count == 0 { return call.resolve(["deleted": true]) }
        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest.deleteAssets(assets)
        }) { success, _ in
            call.resolve(["deleted": success])
        }
    }

    /// Adds photos to the Photos album named `title`, creating it if needed. Albums only
    /// point at the originals, so this takes no extra storage. Photos already in the album
    /// are skipped by iOS.
    @objc func addToAlbum(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        let title = (call.getString("title") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { return call.reject("Missing album name") }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        if assets.count == 0 { return call.reject("Those photos are no longer on this phone", "NOT_FOUND") }

        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "localizedTitle = %@", title)
        let existing = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: options).firstObject

        PHPhotoLibrary.shared().performChanges({
            let request: PHAssetCollectionChangeRequest?
            if let album = existing {
                request = PHAssetCollectionChangeRequest(for: album)
            } else {
                request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
            }
            request?.addAssets(assets)
        }) { success, error in
            if success {
                call.resolve(["added": assets.count, "title": title, "created": existing == nil])
            } else {
                call.reject(error?.localizedDescription ?? "Could not add photos to the album")
            }
        }
    }

    /// Loads a photo's full-size image data, downloading it from iCloud if needed.
    private func originalData(_ call: CAPPluginCall, _ done: @escaping (PHAsset, Data, String?) -> Void) {
        guard let id = call.getString("id") else { return call.reject("Missing id") }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            return call.reject("That photo is no longer on this phone", "NOT_FOUND")
        }
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, _ in
            guard let data = data else { return call.reject("Could not load photo") }
            done(asset, data, uti)
        }
    }

    /// Copies a photo so it can be pasted into Messages, Notes and other apps, like Copy in Photos.
    /// A video is copied as the movie file.
    @objc func copyImage(_ call: CAPPluginCall) {
        if let asset = videoAsset(call) {
            return VideoFrames.playableFile(for: asset) { result in
                guard case .success(let file) = result, let data = try? Data(contentsOf: file) else {
                    return call.reject("Could not copy video")
                }
                let type = UTType(filenameExtension: file.pathExtension) ?? .movie
                DispatchQueue.main.async {
                    UIPasteboard.general.setData(data, forPasteboardType: type.identifier)
                    call.resolve()
                }
            }
        }
        originalData(call) { _, data, _ in
            DispatchQueue.main.async {
                guard let image = UIImage(data: data) else { return call.reject("Could not copy photo") }
                UIPasteboard.general.image = image
                call.resolve()
            }
        }
    }

    /// Opens the iOS share sheet for a photo (AirDrop, Messages, Save Image, Copy and the rest).
    /// Resolves with completed: false if the person closes it without sharing.
    @objc func shareImage(_ call: CAPPluginCall) {
        if let asset = videoAsset(call) {
            return VideoFrames.playableFile(for: asset) { result in
                guard case .success(let file) = result else { return call.reject("Could not share video") }
                self.presentShareSheet(file, call)
            }
        }
        originalData(call) { asset, data, uti in
            let original = PHAssetResource.assetResources(for: asset).first?.originalFilename
            let ext = uti.flatMap { UTType($0)?.preferredFilenameExtension } ?? "jpg"
            let base = (original as NSString?)?.deletingPathExtension ?? "Photo"
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
            try? FileManager.default.removeItem(at: dir)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent("\(base).\(ext)")
            do {
                try data.write(to: file)
            } catch {
                return call.reject("Could not share photo")
            }
            self.presentShareSheet(file, call)
        }
    }

    /// The video asset a call names, or nil for a photo (or a missing id, which the photo path reports).
    private func videoAsset(_ call: CAPPluginCall) -> PHAsset? {
        guard let id = call.getString("id"),
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
              asset.mediaType == .video else { return nil }
        return asset
    }

    private func presentShareSheet(_ file: URL, _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { return call.reject("Could not share photo") }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            // iPad shows the sheet as a popover, which needs a place to point at.
            sheet.popoverPresentationController?.sourceView = host.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 0, height: 0)
            sheet.popoverPresentationController?.permittedArrowDirections = []
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["completed": completed])
            }
            host.present(sheet, animated: true)
        }
    }
}
