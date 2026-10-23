package com.organizeit.photolibrary;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * Lets the app hand the background sorter its snapshot and collect what was sorted while it
 * was closed. The sorting itself lives in BackgroundSorter and BackgroundSortWorker.
 */
@CapacitorPlugin(name = "BackgroundSort")
public class BackgroundSortPlugin extends Plugin {

    @Override
    public void load() {
        BackgroundSorter.appVisible = true;
    }

    @Override
    protected void handleOnStart() {
        BackgroundSorter.appVisible = true;
    }

    @Override
    protected void handleOnStop() {
        BackgroundSorter.appVisible = false;
    }

    @PluginMethod
    public void configure(PluginCall call) {
        BackgroundSortStore store = new BackgroundSortStore(getContext());
        store.saveConfig(call.getData());
        BackgroundSortWorker.schedule(getContext());
        if (BackgroundSorter.appVisible && new BackgroundSorter(getContext()).queuedCount() > 0) {
            BackgroundSortWorker.keepGoing(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void takeResults(PluginCall call) {
        JSONArray results = new BackgroundSortStore(getContext()).takeResults();
        JSObject ret = new JSObject();
        try {
            ret.put("results", new JSArray(results.toString()));
        } catch (Exception e) {
            ret.put("results", new JSArray());
        }
        call.resolve(ret);
    }
}
