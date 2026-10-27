import AVFoundation
import Foundation
import Photos
import UIKit

/// Stills from videos in the Photos library. Videos are sorted from four frames taken across
/// the clip, laid out in a 2x2 grid in one JPEG, so the AI sees what the whole video shows. Used
/// by the plugin (while the app is open) and by the background sorter.
enum VideoFrames {
    /// Where frames are taken from, as a share of the video's length. Matches src/lib/video.ts.
    static let points: [Double] = [0.1, 0.37, 0.63, 0.9]

    /// Every image and video in the library, for fetches that used to ask for images only.
    static func mediaOptions(_ extra: NSPredicate? = nil) -> PHFetchOptions {
        let options = PHFetchOptions()
        let media = NSPredicate(format: "mediaType == %d || mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        options.predicate = extra.map { NSCompoundPredicate(andPredicateWithSubpredicates: [media, $0]) } ?? media
        return options
    }

    /// The 2x2 frame grid as a JPEG no bigger than `maxSide`, with its size. Falls back to the
    /// opening frame when the video itself can't be read (for example, kept only in iCloud and
    /// `download` is false). `download` lets a video kept in iCloud be fetched to read it.
    static func sheet(for asset: PHAsset, maxSide: CGFloat, quality: CGFloat, download: Bool) async -> (Data, CGSize)? {
        if let video = await avAsset(for: asset, download: download) {
            let cell = CGSize(width: maxSide / 2, height: maxSide / 2)
            let frames = await grab(video, duration: asset.duration, maxSize: cell)
            if let first = frames.first {
                let size = first.size
                let canvas = CGSize(width: size.width * 2, height: size.height * 2)
                let renderer = UIGraphicsImageRenderer(size: canvas, format: {
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 1
                    format.opaque = true
                    return format
                }())
                let image = renderer.image { context in
                    UIColor.black.setFill()
                    context.fill(CGRect(origin: .zero, size: canvas))
                    for (i, frame) in frames.enumerated() {
                        let origin = CGPoint(x: CGFloat(i % 2) * size.width, y: CGFloat(i / 2) * size.height)
                        frame.draw(in: CGRect(origin: origin, size: size))
                    }
                }
                if let data = image.jpegData(compressionQuality: quality) {
                    return (data, CGSize(width: image.size.width, height: image.size.height))
                }
            }
        }
        return await poster(for: asset, maxSide: maxSide, quality: quality, download: download)
    }

    /// The opening frame, as Photos shows it, as a JPEG.
    static func poster(for asset: PHAsset, maxSide: CGFloat, quality: CGFloat, download: Bool) async -> (Data, CGSize)? {
        await withCheckedContinuation { continuation in
            let scale = min(1, maxSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
            let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
            let options = PHImageRequestOptions()
            options.isSynchronous = true
            options.deliveryMode = .highQualityFormat
            options.resizeMode = .exact
            options.isNetworkAccessAllowed = download
            DispatchQueue.global(qos: .utility).async {
                var out: (Data, CGSize)?
                PHImageManager.default().requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, _ in
                    if let image = image, let data = image.jpegData(compressionQuality: quality) {
                        out = (data, CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale))
                    }
                }
                continuation.resume(returning: out)
            }
        }
    }

    private static func avAsset(for asset: PHAsset, download: Bool) async -> AVAsset? {
        await withCheckedContinuation { continuation in
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = download
            // A small version is plenty for stills, and much less to download from iCloud.
            options.deliveryMode = .fastFormat
            options.version = .current
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { video, _, _ in
                continuation.resume(returning: video)
            }
        }
    }

    private static func grab(_ video: AVAsset, duration: TimeInterval, maxSize: CGSize) async -> [UIImage] {
        let generator = AVAssetImageGenerator(asset: video)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = maxSize
        let tolerance = CMTime(seconds: max(0.5, duration / 20), preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        var frames: [UIImage] = []
        for point in points {
            let time = CMTime(seconds: duration * point, preferredTimescale: 600)
            if let image = await frame(generator, at: time) { frames.append(UIImage(cgImage: image)) }
        }
        return frames
    }

    private static func frame(_ generator: AVAssetImageGenerator, at time: CMTime) async -> CGImage? {
        if #available(iOS 16.0, *) {
            return try? await generator.image(at: time).image
        }
        return try? generator.copyCGImage(at: time, actualTime: nil)
    }

    /// Copies the video to a temporary file the web view can play, keeping only the latest one.
    static func playableFile(for asset: PHAsset, done: @escaping (Result<URL, Error>) -> Void) {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .fullSizeVideo }) ?? resources.first(where: { $0.type == .video }) else {
            return done(.failure(NSError(domain: "OrganizeIt", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not load this video"])))
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("playing", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ext = (resource.originalFilename as NSString).pathExtension
        let file = dir.appendingPathComponent("\(UUID().uuidString).\(ext.isEmpty ? "mov" : ext)")
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        PHAssetResourceManager.default().writeData(for: resource, toFile: file, options: options) { error in
            if let error = error { done(.failure(error)) } else { done(.success(file)) }
        }
    }
}
