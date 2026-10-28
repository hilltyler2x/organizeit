package com.organizeit.photolibrary;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sorts photos while OrganizeIt is closed, from the snapshot the app handed over, and keeps
 * each answer until the app takes it back and files it. The same steps as the app's own
 * queue (src/lib/useLibrary.ts) in plain Java, since the web view isn't running.
 */
final class BackgroundSorter {

    enum Outcome {
        /** Nothing is left to sort. */
        FINISHED,
        /** Asked to stop (time is up, or the app came back). */
        STOPPED,
        /** Can't sort right now: no photo access, wrong passcode, no AI key, or the server stayed unreachable. */
        BLOCKED,
        /** Another run is already sorting. */
        BUSY,
        /** Stopped to save battery; carries on once the phone charges. */
        PAUSED
    }

    /** What the battery allows background sorting to do right now. */
    static final class Power {

        /** Most photos a background run sorts on battery; the rest wait for the phone to charge. */
        static final int BATTERY_LIMIT = 100;

        final boolean charging;
        /** 0-100, or -1 when Android doesn't say. */
        final int level;
        final boolean saver;

        Power(Context context) {
            BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            charging = battery != null && battery.isCharging();
            int capacity = battery == null ? Integer.MIN_VALUE : battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            level = capacity == Integer.MIN_VALUE ? -1 : capacity;
            saver = pm != null && pm.isPowerSaveMode();
        }

        /** Battery Saver, or under 20%, and not plugged in: background sorting waits. */
        boolean shouldPause() {
            return !charging && (saver || (level >= 0 && level < 20));
        }
    }

    interface StopCheck {
        boolean shouldStop();
    }

    interface Progress {
        void waiting(int count);
    }

    /** True while the app is on screen; it sorts by itself then. */
    static volatile boolean appVisible = false;

    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static final int BATCH = 3;
    /** Same threshold as REVIEW_BELOW in src/core/library.ts. */
    private static final double REVIEW_BELOW = 0.3;

    private final Context context;
    private final BackgroundSortStore store;

    BackgroundSorter(Context context) {
        this.context = context.getApplicationContext();
        this.store = new BackgroundSortStore(this.context);
    }

    static boolean hasPhotoAccess(Context context) {
        String[] permissions = Build.VERSION.SDK_INT >= 34
            ? new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }
            : Build.VERSION.SDK_INT >= 33
                ? new String[] { Manifest.permission.READ_MEDIA_IMAGES }
                : new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED) return true;
        }
        return false;
    }

    /** How many photos the app has queued. */
    int queuedCount() {
        JSONObject config = store.config();
        JSONArray queued = config == null ? null : config.optJSONArray("queued");
        return queued == null ? 0 : queued.length();
    }

    private static class Batch {

        final List<JSONObject> assets = new ArrayList<>();
        int waiting;
    }

    private enum Answer {
        SORTED,
        /** This photo can't be sorted here; left for the app, which retries and shows errors. */
        SKIP,
        /** The server or AI is busy or had a hiccup: try this photo again shortly. */
        RETRY,
        /** No connection, or the server is asleep. */
        OFFLINE,
        /** Wrong passcode, no subscription or no AI key: retrying won't help. */
        PERMANENT
    }

    /** Remembers what background sorting last did, so the app can show it. */
    static void note(Context context, String message) {
        context
            .getSharedPreferences("organizeit-background", Context.MODE_PRIVATE)
            .edit()
            .putString("last", message)
            .putLong("lastAt", System.currentTimeMillis())
            .apply();
    }

    /**
     * Sorts waiting photos, a few at a time, until none are left or stop says so. A dropped
     * connection, a sleeping server or a busy AI is waited out with growing pauses rather than
     * ending the run.
     */
    Outcome run(StopCheck stop, Progress progress) {
        if (!running.compareAndSet(false, true)) return Outcome.BUSY;
        ExecutorService pool = Executors.newFixedThreadPool(BATCH);
        int sorted = 0;
        String ending = null;
        try {
            if (!hasPhotoAccess(context)) {
                note(context, "Stopped: OrganizeIt doesn't have access to Photos.");
                return Outcome.BLOCKED;
            }
            JSONObject first = store.config();
            if (first == null || first.optString("apiUrl").isEmpty()) return Outcome.BLOCKED;
            JSONArray categories = new JSONArray(first.optJSONArray("categories") == null ? "[]" : first.optJSONArray("categories").toString());
            Set<String> skip = new HashSet<>();
            Map<String, Integer> tries = new HashMap<>();
            long pause = 0;
            long waitedSince = 0;
            while (!stop.shouldStop()) {
                Power power = new Power(context);
                if (power.shouldPause()) {
                    ending = "Paused to save battery (" + (power.saver ? "Battery Saver" : "under 20%") + "). Sorting carries on when the phone charges or you open OrganizeIt.";
                    return Outcome.PAUSED;
                }
                if (!power.charging && sorted >= Power.BATTERY_LIMIT) {
                    ending = "The rest will be sorted while the phone charges, or when you open OrganizeIt.";
                    return Outcome.PAUSED;
                }
                // Re-read each round: the app may have sent a newer snapshot.
                JSONObject config = store.config();
                if (config == null) return Outcome.BLOCKED;
                mergeCategories(categories, config.optJSONArray("categories"));
                JSONArray results = store.results();
                for (int i = 0; i < results.length(); i++) {
                    JSONObject asset = results.optJSONObject(i).optJSONObject("asset");
                    if (asset != null) skip.add(asset.optString("id"));
                }
                Batch batch = nextBatch(config, skip);
                if (batch.assets.isEmpty()) return Outcome.FINISHED;
                List<Future<Answer>> answers = new ArrayList<>();
                final JSONArray cats = new JSONArray(categories.toString());
                for (JSONObject asset : batch.assets) {
                    answers.add(pool.submit(() -> classify(asset, config, cats, categories)));
                }
                Answer problem = null;
                int left = batch.waiting;
                for (int i = 0; i < answers.size(); i++) {
                    String id = batch.assets.get(i).optString("id");
                    Answer answer;
                    try {
                        answer = answers.get(i).get();
                    } catch (Exception e) {
                        answer = Answer.SKIP;
                    }
                    if (answer == Answer.SORTED) {
                        skip.add(id);
                        sorted++;
                        left = Math.max(0, left - 1);
                        if (progress != null) progress.waiting(left);
                    } else if (answer == Answer.SKIP) {
                        skip.add(id);
                    } else if (answer == Answer.RETRY) {
                        int n = tries.merge(id, 1, Integer::sum);
                        if (n >= 4) skip.add(id);
                        if (problem == null) problem = Answer.RETRY;
                    } else if (answer == Answer.OFFLINE) {
                        if (problem != Answer.PERMANENT) problem = Answer.OFFLINE;
                    } else {
                        problem = Answer.PERMANENT;
                    }
                }
                if (problem == Answer.PERMANENT) {
                    ending = "Stopped: the server turned the photos down (subscription, passcode or AI key). Open OrganizeIt to see why.";
                    return Outcome.BLOCKED;
                }
                if (problem != null) {
                    // Give the server (which can take a minute to wake) or the network time to come back.
                    // On battery, a few minutes of waiting with the radio on is all it's worth.
                    long now = System.currentTimeMillis();
                    if (waitedSince == 0) waitedSince = now;
                    int minutes = power.charging ? 15 : 3;
                    if (now - waitedSince > minutes * 60_000L) {
                        ending = problem == Answer.OFFLINE
                            ? "Stopped: couldn't reach the sorting server for " + minutes + " minutes."
                            : "Stopped: the sorting server stayed busy for " + minutes + " minutes.";
                        return Outcome.BLOCKED;
                    }
                    pause = Math.min(Math.max(pause * 2, 5), 60);
                    for (long s = 0; s < pause && !stop.shouldStop(); s++) Thread.sleep(1000);
                } else {
                    pause = 0;
                    waitedSince = 0;
                }
            }
            return Outcome.STOPPED;
        } catch (Exception e) {
            return Outcome.BLOCKED;
        } finally {
            pool.shutdownNow();
            running.set(false);
            String done = sorted > 0 ? "Sorted " + sorted + " photo" + (sorted == 1 ? "" : "s") + " in the background." : null;
            if (done != null || ending != null) note(context, done == null ? ending : ending == null ? done : done + " " + ending);
        }
    }

    private static void mergeCategories(JSONArray into, JSONArray from) {
        if (from == null) return;
        for (int i = 0; i < from.length(); i++) {
            JSONObject c = from.optJSONObject(i);
            if (c != null) addCategory(into, c.optString("section"), c.optString("name"));
        }
    }

    private static synchronized void addCategory(JSONArray into, String section, String name) {
        for (int i = 0; i < into.length(); i++) {
            JSONObject c = into.optJSONObject(i);
            if (c != null && section.equals(c.optString("section")) && name.equals(c.optString("name"))) return;
        }
        try {
            into.put(new JSONObject().put("section", section).put("name", name));
        } catch (Exception ignored) {}
    }

    /** The next photos to sort: ones the app queued, then ones added since it was last open. */
    private Batch nextBatch(JSONObject config, Set<String> skip) {
        Batch batch = new Batch();
        ContentResolver resolver = context.getContentResolver();
        JSONArray queuedJson = config.optJSONArray("queued");
        Set<String> queuedSet = new HashSet<>();
        List<String> queued = new ArrayList<>();
        for (int i = 0; queuedJson != null && i < queuedJson.length(); i++) {
            String id = queuedJson.optString(i);
            queuedSet.add(id);
            if (!skip.contains(id)) queued.add(id);
        }
        if (!queued.isEmpty()) {
            List<String> wanted = queued.subList(0, Math.min(queued.size(), BATCH * 2));
            List<JSONObject> found = new ArrayList<>();
            for (boolean video : new boolean[] { false, true }) {
                List<String> rows = new ArrayList<>();
                for (String id : wanted) if (MediaAssets.isVideo(id) == video) rows.add(MediaAssets.rowId(id));
                if (rows.isEmpty()) continue;
                StringBuilder where = new StringBuilder(MediaStore.MediaColumns._ID + " IN (");
                for (int i = 0; i < rows.size(); i++) where.append(i == 0 ? "?" : ",?");
                where.append(")");
                try (Cursor c = resolver.query(MediaAssets.table(video), MediaAssets.projection(video), where.toString(), rows.toArray(new String[0]), null)) {
                    if (c != null && c.moveToFirst()) {
                        MediaAssets.Columns cols = new MediaAssets.Columns(c);
                        do found.add(MediaAssets.describe(c, cols)); while (c.moveToNext());
                    }
                }
            }
            // Keep the app's order (newest first); photos deleted since are dropped.
            for (String id : wanted) {
                for (JSONObject a : found) {
                    if (id.equals(a.optString("id")) && batch.assets.size() < BATCH) batch.assets.add(a);
                }
                if (found.stream().noneMatch((a) -> id.equals(a.optString("id")))) skip.add(id);
            }
        }
        long knownUpTo = (long) config.optDouble("knownUpTo", 0);
        int fresh = 0;
        String where = "(" + MediaStore.MediaColumns.DATE_TAKEN + " > ? OR " + MediaStore.MediaColumns.DATE_ADDED + " > ?)";
        String[] args = { String.valueOf(knownUpTo), String.valueOf(knownUpTo / 1000) };
        String order = MediaStore.MediaColumns.DATE_ADDED + " DESC";
        for (boolean video : new boolean[] { false, true }) {
            try (Cursor c = resolver.query(MediaAssets.table(video), MediaAssets.projection(video), where, args, order)) {
                if (c != null && c.moveToFirst()) {
                    MediaAssets.Columns cols = new MediaAssets.Columns(c);
                    do {
                        String id = (video ? MediaAssets.VIDEO_PREFIX : "") + c.getLong(cols.id);
                        if (skip.contains(id) || queuedSet.contains(id)) continue;
                        fresh++;
                        if (batch.assets.size() < BATCH) batch.assets.add(MediaAssets.describe(c, cols));
                    } while (c.moveToNext() && fresh < 500);
                }
            }
        }
        batch.waiting = queued.size() + fresh;
        return batch;
    }

    private Answer classify(JSONObject asset, JSONObject config, JSONArray categories, JSONArray learned) {
        String image;
        try {
            // A video is sent as six frames from across it in one larger grid image.
            boolean video = MediaAssets.isVideo(asset.getString("id"));
            Bitmap bitmap = MediaAssets.still(context, asset.getString("id"), video ? MediaAssets.SHEET_SIDE : 768, true);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out);
            bitmap.recycle();
            image = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return Answer.SKIP; // left for the app, which retries and shows errors
        }
        HttpURLConnection http = null;
        try {
            String name = asset.optString("fileName");
            JSONObject body = new JSONObject();
            body.put("image", image);
            body.put("mediaType", "image/jpeg");
            body.put("fileName", name.length() > 300 ? name.substring(0, 300) : name);
            body.put("width", asset.optInt("width"));
            body.put("height", asset.optInt("height"));
            body.put("isScreenshot", asset.optBoolean("isScreenshot"));
            if (asset.optBoolean("isVideo")) {
                body.put("isVideo", true);
                body.put("durationSec", Math.round(asset.optLong("durationMs") / 1000.0));
            }
            body.put("categories", categories);
            body.put("lessons", config.optJSONArray("lessons") == null ? new JSONArray() : config.optJSONArray("lessons"));
            http = (HttpURLConnection) new URL(config.getString("apiUrl") + "/api/classify").openConnection();
            http.setRequestMethod("POST");
            http.setConnectTimeout(30_000);
            http.setReadTimeout(90_000); // the free server can take a minute to wake
            http.setDoOutput(true);
            http.setRequestProperty("content-type", "application/json");
            http.setRequestProperty("x-organizeit-passcode", config.optString("passcode"));
            if (!config.optString("userId").isEmpty()) http.setRequestProperty("x-organizeit-user", config.optString("userId"));
            try (OutputStream os = http.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = http.getResponseCode();
            // Wrong passcode, no subscription (or this month's photos used up), or no working AI key.
            if (code == 401 || code == 402 || code == 503) return Answer.PERMANENT;
            if (code == 429 || code >= 500) return Answer.RETRY;
            if (code != 200) return Answer.SKIP;
            ByteArrayOutputStream text = new ByteArrayOutputStream();
            try (InputStream in = http.getInputStream()) {
                byte[] buf = new byte[8192];
                for (int n; (n = in.read(buf)) > 0; ) text.write(buf, 0, n);
            }
            JSONObject json = new JSONObject(text.toString("UTF-8"));
            JSONObject result = new JSONObject();
            result.put("section", json.getString("section"));
            result.put("category", json.getString("category"));
            result.put("label", json.getString("label"));
            result.put("confidence", json.getDouble("confidence"));
            store.addResult(asset, result);
            if (result.getDouble("confidence") >= REVIEW_BELOW) addCategory(learned, result.getString("section"), result.getString("category"));
            return Answer.SORTED;
        } catch (java.io.IOException e) {
            return Answer.OFFLINE; // no connection, or the server is asleep
        } catch (Exception e) {
            return Answer.SKIP;
        } finally {
            if (http != null) http.disconnect();
        }
    }
}
