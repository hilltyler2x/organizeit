package com.organizeit.photolibrary;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
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
            String order = MediaStore.Images.Media.DATE_ADDED + " ASC, " + MediaStore.Images.Media._ID + " ASC";
            try (
                Cursor c = getContext()
                    .getContentResolver()
                    .query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaAssets.projection(), null, null, order)
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
}
