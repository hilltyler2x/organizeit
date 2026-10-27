package com.organizeit.photolibrary;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Rect;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * MediaStore helpers shared by the photo library plugin and the background sorter. Photos and
 * videos live in separate MediaStore tables whose ids can overlap, so a video's id carries the
 * prefix "video:" and a photo's is the plain number it always was.
 */
final class MediaAssets {

    static final String VIDEO_PREFIX = "video:";
    /** Where frames are taken from, as a share of the video's length. Matches src/lib/video.ts. */
    private static final double[] FRAME_POINTS = { 0.1, 0.37, 0.63, 0.9 };

    private MediaAssets() {}

    static boolean isVideo(String id) {
        return id.startsWith(VIDEO_PREFIX);
    }

    /** The MediaStore row id, without the video prefix. */
    static String rowId(String id) {
        return isVideo(id) ? id.substring(VIDEO_PREFIX.length()) : id;
    }

    static Uri table(boolean video) {
        return video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    }

    static String[] projection(boolean video) {
        String[] base = projection();
        if (!video) return base;
        String[] out = java.util.Arrays.copyOf(base, base.length + 1);
        out[base.length] = MediaStore.Video.Media.DURATION;
        return out;
    }

    static String[] projection() {
        List<String> projection = new ArrayList<>();
        projection.add(MediaStore.Images.Media._ID);
        projection.add(MediaStore.Images.Media.DISPLAY_NAME);
        projection.add(MediaStore.Images.Media.WIDTH);
        projection.add(MediaStore.Images.Media.HEIGHT);
        projection.add(MediaStore.Images.Media.DATE_TAKEN);
        projection.add(MediaStore.Images.Media.DATE_ADDED);
        projection.add(MediaStore.Images.Media.SIZE);
        projection.add(MediaStore.Images.Media.MIME_TYPE);
        if (Build.VERSION.SDK_INT >= 29) projection.add(MediaStore.Images.Media.RELATIVE_PATH);
        return projection.toArray(new String[0]);
    }

    /** Column positions for a cursor made with projection(). */
    static final class Columns {

        final int id, name, width, height, taken, added, size, mime, path, duration;

        Columns(Cursor c) {
            duration = c.getColumnIndex(MediaStore.Video.Media.DURATION);
            id = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
            name = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
            width = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH);
            height = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT);
            taken = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
            added = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
            size = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
            mime = c.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
            path = Build.VERSION.SDK_INT >= 29 ? c.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH) : -1;
        }
    }

    /** The current row as the app's DeviceAsset (src/core/library.ts). */
    static JSObject describe(Cursor c, Columns col) {
        long taken = c.getLong(col.taken);
        String name = c.getString(col.name);
        String path = col.path >= 0 ? c.getString(col.path) : null;
        boolean video = col.duration >= 0;
        JSObject a = new JSObject();
        a.put("id", (video ? VIDEO_PREFIX : "") + c.getLong(col.id));
        a.put("fileName", name == null ? "" : name);
        a.put("width", c.getInt(col.width));
        a.put("height", c.getInt(col.height));
        a.put("createdAt", taken > 0 ? taken : c.getLong(col.added) * 1000);
        a.put("bytes", c.getLong(col.size));
        a.put("mimeType", c.getString(col.mime) == null ? (video ? "video/mp4" : "image/jpeg") : c.getString(col.mime));
        if (video) {
            a.put("isVideo", true);
            a.put("durationMs", c.getLong(col.duration));
        }
        a.put(
            "isScreenshot",
            (path != null && path.toLowerCase().contains("screenshot")) || (name != null && name.toLowerCase().startsWith("screenshot"))
        );
        return a;
    }

    static Uri uriFor(String id) {
        return ContentUris.withAppendedId(table(isVideo(id)), Long.parseLong(rowId(id)));
    }

    /**
     * A still for any asset: the photo itself, or for a video its opening frame or (with
     * frames) four frames from across it in a 2x2 grid, for sorting.
     */
    static Bitmap still(Context context, String id, int maxSide, boolean frames) throws Exception {
        if (!isVideo(id)) return decode(context.getContentResolver(), uriFor(id), maxSide);
        return frames ? frameSheet(context, uriFor(id), maxSide) : videoFrame(context, uriFor(id), maxSide);
    }

    static Bitmap videoFrame(Context context, Uri uri, int maxSide) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                return context.getContentResolver().loadThumbnail(uri, new android.util.Size(maxSide, maxSide), null);
            } catch (Exception ignored) {
                // Fall back to reading a frame ourselves.
            }
        }
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, uri);
            Bitmap frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) throw new Exception("Could not read video");
            return scale(frame, maxSide);
        } finally {
            retriever.release();
        }
    }

    static Bitmap frameSheet(Context context, Uri uri, int maxSide) throws Exception {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        List<Bitmap> frames = new ArrayList<>();
        try {
            retriever.setDataSource(context, uri);
            String length = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long durationUs = (length == null ? 0 : Long.parseLong(length)) * 1000;
            int cell = Math.max(1, maxSide / 2);
            for (double point : FRAME_POINTS) {
                Bitmap frame = retriever.getFrameAtTime((long) (durationUs * point), MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                if (frame != null) frames.add(scale(frame, cell));
            }
        } finally {
            retriever.release();
        }
        if (frames.isEmpty()) return videoFrame(context, uri, maxSide);
        int w = frames.get(0).getWidth();
        int h = frames.get(0).getHeight();
        Bitmap sheet = Bitmap.createBitmap(w * 2, h * 2, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(sheet);
        canvas.drawColor(Color.BLACK);
        for (int i = 0; i < frames.size(); i++) {
            int x = (i % 2) * w;
            int y = (i / 2) * h;
            canvas.drawBitmap(frames.get(i), null, new Rect(x, y, x + w, y + h), null);
            frames.get(i).recycle();
        }
        return sheet;
    }

    private static Bitmap scale(Bitmap b, int maxSide) {
        float scale = Math.min(1f, (float) maxSide / Math.max(b.getWidth(), b.getHeight()));
        if (scale >= 1f) return b;
        Bitmap scaled = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * scale)), Math.max(1, Math.round(b.getHeight() * scale)), true);
        b.recycle();
        return scaled;
    }

    static Bitmap decode(ContentResolver resolver, Uri uri, int maxSide) throws Exception {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies the photo's EXIF rotation.
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri), (decoder, info, source) -> {
                int w = info.getSize().getWidth();
                int h = info.getSize().getHeight();
                float scale = Math.min(1f, (float) maxSide / Math.max(w, h));
                decoder.setTargetSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            });
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = resolver.openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (opts.inSampleSize * 2) >= maxSide) opts.inSampleSize *= 2;
        try (InputStream in = resolver.openInputStream(uri)) {
            Bitmap b = BitmapFactory.decodeStream(in, null, opts);
            if (b == null) throw new Exception("Unsupported image");
            float scale = Math.min(1f, (float) maxSide / Math.max(b.getWidth(), b.getHeight()));
            if (scale >= 1f) return b;
            Bitmap scaled = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * scale), Math.round(b.getHeight() * scale), true);
            b.recycle();
            return scaled;
        }
    }
}
