import AVFoundation
import Foundation
import Photos
import UIKit

/// Stills from videos in the Photos library. Videos are sorted from six frames taken across
/// the clip, laid out in a grid in one JPEG, so the AI sees what the whole video shows. Used
/// by the plugin (while the app is open) and by the background sorter. Matches src/lib/video.ts.
enum VideoFrames {
    /// Where frames are taken from, as a share of the video's length: the middle of six equal
    /// parts, skipping the very start and end.
    static let points: [Double] = [1.0, 3.0, 5.0, 7.0, 9.0, 11.0].map { $0 / 12.0 }
    /// Longest side of the frame grid sent to the classifier. Photos go at 768.
    static let sheetSide: CGFloat = 1152
    /// Black lines between frames, so the AI reads them as separate pictures.
    static let gutter: CGFloat = 6
    /// A frame whose brightness varies less than this (0-255) is blank and swapped for a later one.
    static let blankSpread: Double = 10

    /// Every image and video in the library, for fetches that used to ask for images only.
    static func mediaOptions(_ extra: NSPredicate? = nil) -> PHFetchOptions {
        let options = PHFetchOptions()
        let media = NSPredicate(format: "mediaType == %d || mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        options.predicate = extra.map { NSCompoundPredicate(andPredicateWithSubpredicates: [media, $0]) } ?? media
        return options
    }

    /// The frame grid as a JPEG no bigger than `maxSide`, with its size. Tall videos go three
    /// across and two down, wide ones two across and three down. Falls back to the opening frame
    /// when the video itself can't be read (for example, kept only in iCloud and `download` is
    /// false). `download` lets a video kept in iCloud be fetched to read it.
    static func sheet(for asset: PHAsset, maxSide: CGFloat, quality: CGFloat, download: Bool) async -> (Data, CGSize)? {
        if let video = await avAsset(for: asset, download: download) {
            let w = CGFloat(max(asset.pixelWidth, 1))
            let h = CGFloat(max(asset.pixelHeight, 1))
            let cols = h > w ? 3 : 2
            let rows = (points.count + cols - 1) / cols
            let scale = min(1, (maxSide - CGFloat(cols - 1) * gutter) / (CGFloat(cols) * w), (maxSide - CGFloat(rows - 1) * gutter) / (CGFloat(rows) * h))
            let cell = CGSize(width: max(1, floor(w * scale)), height: max(1, floor(h * scale)))
            let frames = await grab(video, duration: asset.duration, maxSize: CGSize(width: max(cell.width, cell.height), height: max(cell.width, cell.height)))
            if !frames.isEmpty {
                let canvas = CGSize(
                    width: CGFloat(cols) * cell.width + CGFloat(cols - 1) * gutter,
                    height: CGFloat(rows) * cell.height + CGFloat(rows - 1) * gutter
                )
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
                        let origin = CGPoint(x: CGFloat(i % cols) * (cell.width + gutter), y: CGFloat(i / cols) * (cell.height + gutter))
                        frame.draw(in: CGRect(origin: origin, size: cell))
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
            // A 720p-class version keeps product details and receipt text readable in each
            // frame without downloading the full original from iCloud.
            options.deliveryMode = .mediumQualityFormat
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
        let tolerance = CMTime(seconds: min(0.5, duration / 48), preferredTimescale: 600)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        var frames: [UIImage] = []
        for point in points {
            var image = await frame(generator, at: CMTime(seconds: duration * point, preferredTimescale: 600))
            if let shown = image, isBlank(shown), duration > 0 {
                // A black or faded frame tells the AI nothing: try a little later in the clip.
                image = await frame(generator, at: CMTime(seconds: duration * min(0.97, point + 1.0 / 24), preferredTimescale: 600)) ?? shown
            }
            if let image = image { frames.append(UIImage(cgImage: image)) }
        }
        return frames
    }

    /// Whether a frame is nearly one flat shade (black, white, a fade).
    private static func isBlank(_ image: CGImage) -> Bool {
        let side = 16
        guard let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
        context.interpolationQuality = .low
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let data = context.data else { return false }
        let pixels = data.bindMemory(to: UInt8.self, capacity: side * side)
        let values = (0..<(side * side)).map { Double(pixels[$0]) }
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
        return variance.squareRoot() < blankSpread
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
