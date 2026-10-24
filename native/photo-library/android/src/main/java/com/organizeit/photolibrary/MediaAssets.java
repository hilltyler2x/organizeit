package com.organizeit.photolibrary;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** MediaStore helpers shared by the photo library plugin and the background sorter. */
final class MediaAssets {

    private MediaAssets() {}

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

        final int id, name, width, height, taken, added, size, mime, path;

        Columns(Cursor c) {
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
        JSObject a = new JSObject();
        a.put("id", String.valueOf(c.getLong(col.id)));
        a.put("fileName", name == null ? "" : name);
        a.put("width", c.getInt(col.width));
        a.put("height", c.getInt(col.height));
        a.put("createdAt", taken > 0 ? taken : c.getLong(col.added) * 1000);
        a.put("bytes", c.getLong(col.size));
        a.put("mimeType", c.getString(col.mime) == null ? "image/jpeg" : c.getString(col.mime));
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
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
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
