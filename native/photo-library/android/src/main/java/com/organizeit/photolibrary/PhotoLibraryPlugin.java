package com.organizeit.photolibrary;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
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
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/**
 * Gives OrganizeIt read, delete and album access to the Android photo library through
 * MediaStore. Photos are read in place; nothing is copied out except small JPEG previews and
 * the album copies the person asks for (addToAlbum).
 */
@CapacitorPlugin(
    name = "PhotoLibrary",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_IMAGES }, alias = PhotoLibraryPlugin.PHOTOS),
        @Permission(strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }, alias = PhotoLibraryPlugin.SELECTED),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = PhotoLibraryPlugin.STORAGE),
        // Shows the "Sorting photos" progress notification while sorting carries on after the app is closed.
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = PhotoLibraryPlugin.NOTIFICATIONS)
    }
)
public class PhotoLibraryPlugin extends Plugin {

    static final String PHOTOS = "photos";
    static final String SELECTED = "selected";
    static final String STORAGE = "storage";
    static final String NOTIFICATIONS = "notifications";

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
            requestPermissionForAliases(new String[] { PHOTOS, SELECTED, NOTIFICATIONS }, call, "permissionCallback");
        } else if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAliases(new String[] { PHOTOS, NOTIFICATIONS }, call, "permissionCallback");
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
            String order = MediaStore.Images.Media.DATE_ADDED + " ASC, " + MediaStore.Images.Media._ID + " ASC";
            try (
                Cursor c = getContext()
                    .getContentResolver()
                    .query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaAssets.projection(), MediaAssets.notAlbumCopy(), MediaAssets.albumArgs(), order)
            ) {
                JSArray assets = new JSArray();
                int total = c == null ? 0 : c.getCount();
                int end = Math.min(total, offset + limit);
                if (c != null && offset < total && c.moveToPosition(offset)) {
                    MediaAssets.Columns cols = new MediaAssets.Columns(c);
                    do {
                        assets.put(MediaAssets.describe(c, cols));
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
        return MediaAssets.uriFor(id);
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
        return MediaAssets.decode(getContext().getContentResolver(), uri, maxSide);
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
     * Puts copies of photos in the folder Pictures/OrganizeIt/<title>, which Google Photos and
     * gallery apps show as an album named <title>. Android has no albums that only point at
     * the originals, as iOS does, so the copies take space. Photos already there are skipped.
     * OrganizeIt leaves these copies out when it reads the library, so they aren't sorted again.
     */
    @PluginMethod
    public void addToAlbum(PluginCall call) {
        String title = folderName(call.getString("title", ""));
        if (title.isEmpty()) {
            call.reject("Missing album name");
            return;
        }
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("Albums need Android 10 or newer");
            return;
        }
        List<String> ids = new ArrayList<>();
        try {
            JSArray list = call.getArray("ids", new JSArray());
            for (int i = 0; i < list.length(); i++) ids.add(list.getString(i));
        } catch (JSONException e) {
            call.reject("Invalid ids");
            return;
        }
        executor.execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            String folder = MediaAssets.ALBUMS_PATH + title + "/";
            boolean created = !folderHasPhotos(resolver, folder);
            int added = 0;
            int found = 0;
            try {
                for (String id : ids) {
                    Uri source = uriFor(id);
                    String name;
                    String mime;
                    long taken;
                    try (
                        Cursor c = resolver.query(
                            source,
                            new String[] { MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.DATE_TAKEN },
                            null,
                            null,
                            null
                        )
                    ) {
                        if (c == null || !c.moveToFirst()) continue; // deleted since
                        name = c.getString(0) == null ? id + ".jpg" : c.getString(0);
                        mime = c.getString(1) == null ? "image/jpeg" : c.getString(1);
                        taken = c.getLong(2);
                    }
                    found++;
                    if (inFolder(resolver, folder, name)) continue;
                    copy(resolver, source, folder, name, mime, taken);
                    added++;
                }
            } catch (Exception e) {
                call.reject("Could not add photos to the album", e);
                return;
            }
            if (found == 0) {
                call.reject("Those photos are no longer on this phone", "NOT_FOUND");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("added", added);
            ret.put("title", title);
            ret.put("created", created && added > 0);
            call.resolve(ret);
        });
    }

    /** The album name as a folder name: no slashes or other characters folders can't have. */
    private static String folderName(String title) {
        return title.replaceAll("[\\\\/:*?\"<>|]", "-").replaceAll("\\s+", " ").trim().replaceAll("^\\.+", "");
    }

    private static boolean folderHasPhotos(ContentResolver resolver, String folder) {
        String where = MediaStore.Images.Media.RELATIVE_PATH + " = ?";
        try (Cursor c = resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new String[] { MediaStore.Images.Media._ID }, where, new String[] { folder }, null)) {
            return c != null && c.getCount() > 0;
        }
    }

    private static boolean inFolder(ContentResolver resolver, String folder, String name) {
        String where = MediaStore.Images.Media.RELATIVE_PATH + " = ? AND " + MediaStore.Images.Media.DISPLAY_NAME + " = ?";
        try (Cursor c = resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new String[] { MediaStore.Images.Media._ID }, where, new String[] { folder, name }, null)) {
            return c != null && c.getCount() > 0;
        }
    }

    private static void copy(ContentResolver resolver, Uri source, String folder, String name, String mime, long taken) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, folder);
        if (taken > 0) values.put(MediaStore.Images.Media.DATE_TAKEN, taken); // keeps the copy at the photo's own date
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri target = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (target == null) throw new Exception("Could not create the album copy");
        try (InputStream in = resolver.openInputStream(source); OutputStream out = resolver.openOutputStream(target)) {
            if (in == null || out == null) throw new Exception("Could not copy the photo");
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        } catch (Exception e) {
            resolver.delete(target, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(target, done, null, null);
    }
}
