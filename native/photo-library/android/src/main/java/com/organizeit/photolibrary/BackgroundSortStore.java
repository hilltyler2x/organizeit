package com.organizeit.photolibrary;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The snapshot the app hands over (src/lib/backgroundSort.ts) and what was sorted while it
 * was closed, in one small file shared by the app and background work.
 */
final class BackgroundSortStore {

    private static final Object LOCK = new Object();

    private final File file;

    BackgroundSortStore(Context context) {
        file = new File(context.getFilesDir(), "background-sort.json");
    }

    private JSONObject read() {
        try {
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void write(JSONObject contents) {
        File tmp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(contents.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        tmp.renameTo(file);
    }

    /** The app's snapshot, or null before the app has sent one. */
    JSONObject config() {
        synchronized (LOCK) {
            return read().optJSONObject("config");
        }
    }

    void saveConfig(JSONObject config) {
        synchronized (LOCK) {
            JSONObject contents = read();
            try {
                contents.put("config", config);
            } catch (JSONException ignored) {}
            write(contents);
        }
    }

    JSONArray results() {
        synchronized (LOCK) {
            JSONArray results = read().optJSONArray("results");
            return results == null ? new JSONArray() : results;
        }
    }

    void addResult(JSONObject asset, JSONObject result) {
        synchronized (LOCK) {
            JSONObject contents = read();
            JSONArray results = contents.optJSONArray("results");
            if (results == null) results = new JSONArray();
            try {
                JSONObject item = new JSONObject();
                item.put("asset", asset);
                item.put("result", result);
                results.put(item);
                contents.put("results", results);
            } catch (JSONException ignored) {}
            write(contents);
        }
    }

    /** Hands every saved answer to the app and forgets them. */
    JSONArray takeResults() {
        synchronized (LOCK) {
            JSONObject contents = read();
            JSONArray results = contents.optJSONArray("results");
            contents.remove("results");
            write(contents);
            return results == null ? new JSONArray() : results;
        }
    }
}
