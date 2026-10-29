package com.organizeit.photolibrary;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Asks for a Google Play review with Play's own in-app review card, and opens OrganizeIt's
 * Play page to write one. Play decides whether the card shows (it limits how often, and only
 * for apps installed from Play), so asking is always safe.
 */
@CapacitorPlugin(name = "AppReview")
public class AppReviewPlugin extends Plugin {

    @PluginMethod
    public void requestReview(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        ReviewManager manager = ReviewManagerFactory.create(getContext());
        manager.requestReviewFlow().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.resolve();
                return;
            }
            ReviewInfo info = task.getResult();
            manager.launchReviewFlow(activity, info).addOnCompleteListener(done -> call.resolve());
        });
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
            web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(web);
        }
        call.resolve();
    }
}
