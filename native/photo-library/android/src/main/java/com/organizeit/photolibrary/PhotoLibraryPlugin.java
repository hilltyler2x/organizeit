package com.organizeit.photolibrary;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
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
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/**
 * Gives OrganizeIt read, delete, copy and share access to the Android photo library through
 * MediaStore. Photos are read in place; nothing is copied out except small JPEG previews and
 * the one photo being copied or shared.
 */
@CapacitorPlugin(
    name = "PhotoLibrary",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = PhotoLibraryPlugin.PHOTOS),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VIDEO }, alias = PhotoLibraryPlugin.VIDEOS),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }, alias = PhotoLibraryPlugin.SELECTED),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = PhotoLibraryPlugin.STORAGE)
    }
)
public class PhotoLibraryPlugin extends Plugin {

    static final String PHOTOS = "photos";
    static final String VIDEOS = "videos";
    static final String SELECTED = "selected";
    static final String STORAGE = "storage";

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private ActivityResultLauncher<IntentSenderRequest> deleteLauncher;
    private PluginCall pendingDelete;
    private ContentObserver libraryObserver;

    @Override
    protected void handleOnDestroy() {
        if (libraryObserver != null) getContext().getContentResolver().unregisterContentObserver(libraryObserver);
    }

    @Override
    public void load() {
        // Tell the app the moment a photo is added or removed while it is running, so a new
        // photo is sorted right away (event "libraryChanged").
        libraryObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                notifyListeners("libraryChanged", new JSObject());
            }
        };
        getContext().getContentResolver().registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, libraryObserver);
        getContext().getContentResolver().registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, libraryObserver);
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

    /** Whether full access covers videos too. Before Android 13 one permission covers both. */
    private boolean videosAllowed() {
        return Build.VERSION.SDK_INT < 33 || getPermissionState(VIDEOS) == PermissionState.GRANTED;
    }

    private void resolveStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", status());
        ret.put("videos", videosAllowed());
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            requestPermissionForAliases(new String[] { PHOTOS, VIDEOS, SELECTED }, call, "permissionCallback");
        } else if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] { PHOTOS, VIDEOS }, call, "permissionCallback");
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

    /**
     * An id for this phone that stays the same when OrganizeIt is uninstalled and installed
     * again (Android keeps it per app signing key), so the free photos and the subscription
     * follow the phone rather than the install.
     */
    @PluginMethod
    public void deviceId(PluginCall call) {
        String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
        JSObject ret = new JSObject();
        ret.put("id", id == null || id.isEmpty() ? "" : "android-" + id);
        call.resolve(ret);
    }

    /**
     * Pages through every photo, then every video, in the library, oldest first within each.
     * The app sorts by date itself, so the two tables are simply read one after the other.
     */
    @PluginMethod
    public void list(PluginCall call) {
        int offset = Math.max(0, call.getInt("offset", 0));
        int limit = Math.max(1, Math.min(call.getInt("limit", 500), 2000));
        executor.execute(() -> {
            String order = MediaStore.MediaColumns.DATE_ADDED + " ASC, " + MediaStore.MediaColumns._ID + " ASC";
            android.content.ContentResolver resolver = getContext().getContentResolver();
            try (
                Cursor images = resolver.query(MediaAssets.table(false), MediaAssets.projection(false), null, null, order);
                Cursor videos = resolver.query(MediaAssets.table(true), MediaAssets.projection(true), null, null, order)
            ) {
                int imageCount = images == null ? 0 : images.getCount();
                int total = imageCount + (videos == null ? 0 : videos.getCount());
                int end = Math.min(total, offset + limit);
                JSArray assets = new JSArray();
                for (int i = offset; i < end; i++) {
                    Cursor c = i < imageCount ? images : videos;
                    if (c == null || !c.moveToPosition(i < imageCount ? i : i - imageCount)) break;
                    assets.put(MediaAssets.describe(c, new MediaAssets.Columns(c)));
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
        return MediaAssets.uriFor(id);
    }

    /**
     * Returns a JPEG copy of a photo scaled so its longest side is at most maxSide. For a video
     * it is the opening frame or, with frames, four frames from across it in a grid.
     */
    @PluginMethod
    public void getImage(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing id");
            return;
        }
        int maxSide = Math.max(64, call.getInt("maxSide", 1024));
        int quality = (int) Math.round(call.getDouble("quality", 0.8) * 100);
        boolean frames = Boolean.TRUE.equals(call.getBoolean("frames", false));
        executor.execute(() -> {
            try {
                Bitmap bitmap = MediaAssets.still(getContext(), id, maxSide, frames);
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

    /** A content URI the app's web view can play the video from. */
    @PluginMethod
    public void getVideo(PluginCall call) {
        String id = call.getString("id");
        if (id == null || !MediaAssets.isVideo(id)) {
            call.reject("That video is no longer on this phone", "NOT_FOUND");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", uriFor(id).toString());
        call.resolve(ret);
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

    /**
     * Puts a copy of the photo in the app's cache and returns a content URI other apps may
     * read. Only the latest copied or shared photo is kept.
     */
    private Uri shareableCopy(String id) throws Exception {
        Uri source = uriFor(id);
        String name = MediaAssets.isVideo(id) ? "Video.mp4" : "Photo.jpg";
        String[] cols = { MediaStore.MediaColumns.DISPLAY_NAME };
        try (Cursor c = getContext().getContentResolver().query(source, cols, null, null, null)) {
            if (c == null || !c.moveToFirst()) throw new Exception("That photo is no longer on this phone");
            String n = c.getString(0);
            if (n != null && !n.trim().isEmpty()) name = n.replaceAll("[/\\\\]", "_");
        }
        File dir = new File(getContext().getCacheDir(), "shared");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Could not prepare the photo");
        File file = new File(dir, name);
        try (InputStream in = getContext().getContentResolver().openInputStream(source); OutputStream out = new FileOutputStream(file)) {
            if (in == null) throw new Exception("Could not load photo");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private String mimeOf(Uri uri) {
        String type = getContext().getContentResolver().getType(uri);
        return type == null ? "image/*" : type;
    }

    /** Copies a photo so it can be pasted into other apps. */
    @PluginMethod
    public void copyImage(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing id");
            return;
        }
        executor.execute(() -> {
            try {
                Uri uri = shareableCopy(id);
                getActivity().runOnUiThread(() -> {
                    ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newUri(getContext().getContentResolver(), "Photo", uri));
                    call.resolve();
                });
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Could not copy photo" : e.getMessage(), e);
            }
        });
    }

    /** Opens Android's share sheet for a photo. */
    @PluginMethod
    public void shareImage(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing id");
            return;
        }
        executor.execute(() -> {
            try {
                Uri uri = shareableCopy(id);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mimeOf(uri));
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newRawUri("", uri)); // shows the photo in the share sheet
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    getActivity().startActivity(Intent.createChooser(send, null));
                    JSObject ret = new JSObject();
                    ret.put("completed", true);
                    call.resolve(ret);
                });
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Could not share photo" : e.getMessage(), e);
            }
        });
    }
}
