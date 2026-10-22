package com.organizeit.photolibrary;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/**
 * Gives OrganizeIt read and delete access to the Android photo library through MediaStore.
 * Photos are read in place; nothing is copied out except small JPEG previews.
 */
@CapacitorPlugin(
    name = "PhotoLibrary",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = PhotoLibraryPlugin.PHOTOS),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }, alias = PhotoLibraryPlugin.SELECTED),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = PhotoLibraryPlugin.STORAGE)
    }
)
public class PhotoLibraryPlugin extends Plugin {

    static final String PHOTOS = "photos";
    static final String SELECTED = "selected";
    static final String STORAGE = "storage";

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private ActivityResultLauncher<IntentSenderRequest> deleteLauncher;
    private PluginCall pendingDelete;

    @Override
    public void load() {
        deleteLauncher = getActivity()
            .registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), (result) -> {
                if (pendingDelete == null) return;
                JSObject ret = new JSObject();
                ret.put("deleted", result.getResultCode() == Activity.RESULT_OK);
                pendingDelete.resolve(ret);
                pendingDelete = null;
            });
    }

    private String status() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (getPermissionState(PHOTOS) == PermissionState.GRANTED) return "granted";
            if (Build.VERSION.SDK_INT >= 34 && getPermissionState(SELECTED) == PermissionState.GRANTED) return "limited";
            return getPermissionState(PHOTOS) == PermissionState.DENIED ? "denied" : "prompt";
        }
        PermissionState s = getPermissionState(STORAGE);
        if (s == PermissionState.GRANTED) return "granted";
        return s == PermissionState.DENIED ? "denied" : "prompt";
    }

    private void resolveStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", status());
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            requestPermissionForAliases(new String[] { PHOTOS, SELECTED }, call, "permissionCallback");
        } else if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAlias(PHOTOS, call, "permissionCallback");
        } else {
            requestPermissionForAlias(STORAGE, call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Pages through every image in the library, oldest first. */
    @PluginMethod
    public void list(PluginCall call) {
        int offset = Math.max(0, call.getInt("offset", 0));
        int limit = Math.max(1, Math.min(call.getInt("limit", 500), 2000));
        executor.execute(() -> {
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
            String order = MediaStore.Images.Media.DATE_ADDED + " ASC, " + MediaStore.Images.Media._ID + " ASC";
            try (
                Cursor c = getContext()
                    .getContentResolver()
                    .query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection.toArray(new String[0]), null, null, order)
            ) {
                JSArray assets = new JSArray();
                int total = c == null ? 0 : c.getCount();
                int end = Math.min(total, offset + limit);
                if (c != null && offset < total && c.moveToPosition(offset)) {
                    int idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    int nameCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                    int wCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH);
                    int hCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT);
                    int takenCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN);
                    int addedCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                    int sizeCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE);
                    int mimeCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
                    int pathCol = Build.VERSION.SDK_INT >= 29 ? c.getColumnIndex(MediaStore.Images.Media.RELATIVE_PATH) : -1;
                    do {
                        long taken = c.getLong(takenCol);
                        String name = c.getString(nameCol);
                        String path = pathCol >= 0 ? c.getString(pathCol) : null;
                        JSObject a = new JSObject();
                        a.put("id", String.valueOf(c.getLong(idCol)));
                        a.put("fileName", name == null ? "" : name);
                        a.put("width", c.getInt(wCol));
                        a.put("height", c.getInt(hCol));
                        a.put("createdAt", taken > 0 ? taken : c.getLong(addedCol) * 1000);
                        a.put("bytes", c.getLong(sizeCol));
                        a.put("mimeType", c.getString(mimeCol) == null ? "image/jpeg" : c.getString(mimeCol));
                        a.put(
                            "isScreenshot",
                            (path != null && path.toLowerCase().contains("screenshot")) || (name != null && name.toLowerCase().startsWith("screenshot"))
                        );
                        assets.put(a);
                    } while (c.getPosition() < end - 1 && c.moveToNext());
                }
                JSObject ret = new JSObject();
                ret.put("assets", assets);
                ret.put("total", total);
                ret.put("nextOffset", end < total ? end : null);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not read the photo library", e);
            }
        });
    }

    private Uri uriFor(String id) {
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
    }

    /** Returns a JPEG copy of a photo scaled so its longest side is at most maxSide. */
    @PluginMethod
    public void getImage(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing id");
            return;
        }
        int maxSide = Math.max(64, call.getInt("maxSide", 1024));
        int quality = (int) Math.round(call.getDouble("quality", 0.8) * 100);
        executor.execute(() -> {
            try {
                Bitmap bitmap = decode(uriFor(id), maxSide);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out);
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                ret.put("width", bitmap.getWidth());
                ret.put("height", bitmap.getHeight());
                bitmap.recycle();
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not load photo", e);
            }
        });
    }

    private Bitmap decode(Uri uri, int maxSide) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
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

    /**
     * Deletes photos from the library. Android shows its own confirmation (Android 11+).
     * Resolves with deleted: false if the person cancels.
     */
    @PluginMethod
    public void deleteAssets(PluginCall call) {
        List<Uri> uris = new ArrayList<>();
        try {
            JSArray ids = call.getArray("ids", new JSArray());
            for (int i = 0; i < ids.length(); i++) uris.add(uriFor(ids.getString(i)));
        } catch (JSONException e) {
            call.reject("Invalid ids");
            return;
        }
        if (uris.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("deleted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            PendingIntent pi = MediaStore.createDeleteRequest(getContext().getContentResolver(), uris);
            askToDelete(call, pi.getIntentSender());
            return;
        }
        try {
            for (Uri uri : uris) getContext().getContentResolver().delete(uri, null, null);
            JSObject ret = new JSObject();
            ret.put("deleted", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT >= 29 && e instanceof RecoverableSecurityException) {
                askToDelete(call, ((RecoverableSecurityException) e).getUserAction().getActionIntent().getIntentSender());
            } else {
                call.reject("This phone doesn't allow OrganizeIt to delete photos", e);
            }
        }
    }

    private void askToDelete(PluginCall call, android.content.IntentSender sender) {
        pendingDelete = call;
        getActivity().runOnUiThread(() -> deleteLauncher.launch(new IntentSenderRequest.Builder(sender).build()));
    }
}
