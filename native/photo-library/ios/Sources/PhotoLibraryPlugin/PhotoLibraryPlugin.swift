import Capacitor
import Foundation
import Photos
import UIKit
import UniformTypeIdentifiers

/// Gives OrganizeIt read and delete access to the iOS Photos library. Photos are read in
/// place; nothing is copied out except small JPEG previews requested by the app.
@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteAssets", returnType: CAPPluginReturnPromise)
    ]

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

    /// Pages through every image in the library, oldest first.
    @objc func list(_ call: CAPPluginCall) {
        let offset = max(0, call.getInt("offset", 0))
        let limit = max(1, min(call.getInt("limit", 500), 2000))
        DispatchQueue.global(qos: .userInitiated).async {
            let options = PHFetchOptions()
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            let result = PHAsset.fetchAssets(with: .image, options: options)
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
        let resources = PHAssetResource.assetResources(for: asset)
        let original = resources.first { $0.type == .photo } ?? resources.first
        let bytes = (original?.value(forKey: "fileSize") as? NSNumber)?.int64Value ?? 0
        var mimeType = "image/jpeg"
        if let uti = original?.uniformTypeIdentifier, let type = UTType(uti), let mime = type.preferredMIMEType {
            mimeType = mime
        }
        return [
            "id": asset.localIdentifier,
            "fileName": original?.originalFilename ?? "",
            "width": asset.pixelWidth,
            "height": asset.pixelHeight,
            "createdAt": (asset.creationDate ?? Date()).timeIntervalSince1970 * 1000,
            "bytes": bytes,
            "mimeType": mimeType,
            "isScreenshot": asset.mediaSubtypes.contains(.photoScreenshot)
        ]
    }

    /// Returns a JPEG copy of a photo scaled so its longest side is at most `maxSide`.
    @objc func getImage(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("Missing id") }
        let maxSide = CGFloat(max(64, call.getInt("maxSide", 1024)))
        let quality = CGFloat(call.getDouble("quality", 0.8))
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            return call.reject("Photo not found", "NOT_FOUND")
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
}
