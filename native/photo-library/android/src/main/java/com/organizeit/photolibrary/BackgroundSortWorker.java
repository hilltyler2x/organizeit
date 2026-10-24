package com.organizeit.photolibrary;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.provider.MediaStore;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

/**
 * Runs the background sorter when Android allows:
 * - "keep going": started while the app is open with photos waiting, as a foreground service
 *   with a "Sorting photos" notification, so sorting carries on after the app is closed;
 * - "new photo": runs a few seconds after a photo is added to the library;
 * - "periodic": about once an hour, as a fallback.
 */
public class BackgroundSortWorker extends Worker {

    private static final String KIND = "kind";
    private static final String KEEP_GOING = "keep-going";
    private static final String NEW_PHOTO = "new-photo";
    private static final String PERIODIC = "periodic";
    private static final String CHANNEL = "sorting";
    private static final int NOTIFICATION_ID = 7301;

    public BackgroundSortWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    private static Constraints.Builder online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED);
    }

    private static OneTimeWorkRequest.Builder once(String kind) {
        return new OneTimeWorkRequest.Builder(BackgroundSortWorker.class).setInputData(new Data.Builder().putString(KIND, kind).build());
    }

    /** Sorts new photos while the app is closed: soon after one is added, and hourly. */
    static void schedule(Context context) {
        WorkManager wm = WorkManager.getInstance(context);
        wm.enqueueUniquePeriodicWork(
            "organizeit-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(BackgroundSortWorker.class, 1, TimeUnit.HOURS)
                .setConstraints(online().build())
                .setInputData(new Data.Builder().putString(KIND, PERIODIC).build())
                .build()
        );
        watchForNewPhotos(context, ExistingWorkPolicy.KEEP);
    }

    private static void watchForNewPhotos(Context context, ExistingWorkPolicy policy) {
        Constraints constraints = online()
            .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
            .setTriggerContentUpdateDelay(3, TimeUnit.SECONDS)
            .setTriggerContentMaxDelay(15, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("organizeit-new-photo", policy, once(NEW_PHOTO).setConstraints(constraints).build());
    }

    /** Called while the app is open with photos waiting, so sorting carries on once it is closed. */
    static void keepGoing(Context context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "organizeit-keep-going",
            ExistingWorkPolicy.KEEP,
            once(KEEP_GOING).setConstraints(online().build()).build()
        );
    }

    @NonNull
    @Override
    public Result doWork() {
        String kind = getInputData().getString(KIND);
        BackgroundSorter sorter = new BackgroundSorter(getApplicationContext());
        if (KEEP_GOING.equals(kind)) {
            keepGoing(sorter);
        } else if (!BackgroundSorter.appVisible) {
            sorter.run(this::isStopped, null);
        }
        // A content trigger fires once; watch again for the next photo.
        if (NEW_PHOTO.equals(kind)) watchForNewPhotos(getApplicationContext(), ExistingWorkPolicy.APPEND_OR_REPLACE);
        return Result.success();
    }

    private void keepGoing(BackgroundSorter sorter) {
        try {
            setForegroundAsync(foregroundInfo(sorter.queuedCount())).get();
        } catch (Exception e) {
            // Not allowed right now (the app was already closed): carry on as ordinary work.
        }
        while (!isStopped()) {
            if (BackgroundSorter.appVisible) {
                // The app sorts by itself while it is open; follow along.
                int waiting = sorter.queuedCount();
                if (waiting == 0) return;
                showProgress(waiting);
                pause();
                continue;
            }
            BackgroundSorter.Outcome outcome = sorter.run(() -> isStopped() || BackgroundSorter.appVisible, this::showProgress);
            if (outcome == BackgroundSorter.Outcome.FINISHED || outcome == BackgroundSorter.Outcome.BLOCKED) return;
            if (outcome == BackgroundSorter.Outcome.BUSY) pause();
        }
    }

    private static void pause() {
        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void showProgress(int waiting) {
        NotificationManager nm = (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, notification(waiting));
    }

    private Notification notification(int waiting) {
        Context context = getApplicationContext();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Sorting photos", NotificationManager.IMPORTANCE_LOW));
            }
        }
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Sorting photos")
            .setContentText(waiting == 1 ? "1 to go" : waiting + " to go")
            .setOngoing(true)
            .setSilent(true)
            .build();
    }

    private ForegroundInfo foregroundInfo(int waiting) {
        if (Build.VERSION.SDK_INT >= 29) {
            return new ForegroundInfo(NOTIFICATION_ID, notification(waiting), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(NOTIFICATION_ID, notification(waiting));
    }
}
