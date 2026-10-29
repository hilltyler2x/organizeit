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
import android.graphics.Paint;
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
    /**
     * Where frames are taken from, as a share of the video's length: the middle of six equal
     * parts, skipping the very start and end. Matches src/lib/video.ts.
     */
    private static final double[] FRAME_POINTS = { 1 / 12.0, 3 / 12.0, 5 / 12.0, 7 / 12.0, 9 / 12.0, 11 / 12.0 };
    /** Longest side of the frame grid sent to the classifier. Photos go at 768. */
    static final int SHEET_SIDE = 1152;
    /** Black lines between frames, so the AI reads them as separate pictures. */
    private static final int GUTTER = 6;
    /** A frame whose brightness varies less than this (0-255) is blank and swapped for a later one. */
    private static final double BLANK_SPREAD = 10;

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

    /** Where OrganizeIt puts album copies (addToAlbum): Pictures/OrganizeIt/<album>/. */
    static final String ALBUMS_PATH = "Pictures/OrganizeIt/";

    /**
     * Leaves out OrganizeIt's own album copies, so they aren't sorted a second time. Pass the
     * result as a query's selection, with albumArgs() (AND-ed onto any other condition).
     */
    static String notAlbumCopy() {
        if (Build.VERSION.SDK_INT < 29) return "1";
        return "(" + MediaStore.Images.Media.RELATIVE_PATH + " IS NULL OR " + MediaStore.Images.Media.RELATIVE_PATH + " NOT LIKE ?)";
    }

    static String[] albumArgs() {
        return Build.VERSION.SDK_INT < 29 ? new String[0] : new String[] { ALBUMS_PATH + "%" };
    }

    static String[] concat(String[] a, String[] b) {
        String[] out = new String[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    static Uri uriFor(String id) {
        return ContentUris.withAppendedId(table(isVideo(id)), Long.parseLong(rowId(id)));
    }

    /**
     * A still for any asset: the photo itself, or for a video its opening frame or (with
     * frames) six frames from across it in a grid, for sorting.
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

    /**
     * Six frames from across a video in one grid no bigger than maxSide, in time order. Tall
     * videos go three across and two down, wide ones two across and three down.
     */
    static Bitmap frameSheet(Context context, Uri uri, int maxSide) throws Exception {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        List<Bitmap> frames = new ArrayList<>();
        int cols, rows, cellW, cellH;
        try {
            retriever.setDataSource(context, uri);
            String length = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long durationUs = (length == null ? 0 : Long.parseLong(length)) * 1000;
            int w = Math.max(1, parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)));
            int h = Math.max(1, parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)));
            int rotation = parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            if (rotation == 90 || rotation == 270) {
                int t = w;
                w = h;
                h = t;
            }
            cols = h > w ? 3 : 2;
            rows = (FRAME_POINTS.length + cols - 1) / cols;
            double s = Math.min(1, Math.min((double) (maxSide - (cols - 1) * GUTTER) / (cols * w), (double) (maxSide - (rows - 1) * GUTTER) / (rows * h)));
            cellW = Math.max(1, (int) Math.floor(w * s));
            cellH = Math.max(1, (int) Math.floor(h * s));
            int cell = Math.max(cellW, cellH);
            for (double point : FRAME_POINTS) {
                Bitmap frame = frameAt(retriever, (long) (durationUs * point), cell);
                if (frame != null && isBlank(frame) && durationUs > 0) {
                    // A black or faded frame tells the AI nothing: try a little later in the clip.
                    Bitmap later = frameAt(retriever, (long) (durationUs * Math.min(0.97, point + 1 / 24.0)), cell);
                    if (later != null) {
                        frame.recycle();
                        frame = later;
                    }
                }
                if (frame != null) frames.add(frame);
            }
        } finally {
            retriever.release();
        }
        if (frames.isEmpty()) return videoFrame(context, uri, maxSide);
        Bitmap sheet = Bitmap.createBitmap(cols * cellW + (cols - 1) * GUTTER, rows * cellH + (rows - 1) * GUTTER, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(sheet);
        canvas.drawColor(Color.BLACK);
        Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
        for (int i = 0; i < frames.size(); i++) {
            int x = (i % cols) * (cellW + GUTTER);
            int y = (i / cols) * (cellH + GUTTER);
            canvas.drawBitmap(frames.get(i), null, new Rect(x, y, x + cellW, y + cellH), paint);
            frames.get(i).recycle();
        }
        return sheet;
    }

    /** The frame nearest a time, no bigger than maxSide. Exact frames, not the nearest keyframe. */
    private static Bitmap frameAt(MediaMetadataRetriever retriever, long timeUs, int maxSide) {
        try {
            if (Build.VERSION.SDK_INT >= 27) {
                return retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST, maxSide, maxSide);
            }
            Bitmap frame = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST);
            return frame == null ? null : scale(frame, maxSide);
        } catch (Exception e) {
            return null;
        }
    }

    /** Whether a frame is nearly one flat shade (black, white, a fade). */
    private static boolean isBlank(Bitmap frame) {
        Bitmap tiny = Bitmap.createScaledBitmap(frame, 16, 16, true);
        int[] px = new int[256];
        tiny.getPixels(px, 0, 16, 0, 0, 16, 16);
        if (tiny != frame) tiny.recycle();
        double sum = 0, sq = 0;
        for (int p : px) {
            double g = 0.299 * Color.red(p) + 0.587 * Color.green(p) + 0.114 * Color.blue(p);
            sum += g;
            sq += g * g;
        }
        double mean = sum / px.length;
        return Math.sqrt(Math.max(0, sq / px.length - mean * mean)) < BLANK_SPREAD;
    }

    private static int parseInt(String value) {
        try {
            return value == null ? 0 : Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
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
