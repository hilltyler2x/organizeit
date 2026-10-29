#!/usr/bin/env bash
# Records the Google Play foreground-service demo on a running Android emulator: the app sorts
# a fresh camera roll, keeps going with its "Sorting photos" notification after it is closed,
# and shows the sorted categories when reopened.
# Usage: record-android-demo.sh <app.apk> <photo-dir> <out-dir>
set -u
APK=$1 PHOTOS=$2 OUT=$3
PKG=com.organizeit.app
mkdir -p "$OUT"
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
shade() { adb shell cmd statusbar expand-notifications; sleep "$1"; shot "shade-$2"; adb shell cmd statusbar collapse; }

adb wait-for-device
adb shell settings put global window_animation_scale 1
adb install -r "$APK"
adb shell mkdir -p /sdcard/Pictures/Camera
adb push "$PHOTOS"/. /sdcard/Pictures/Camera/
adb shell content call --method scan_volume --uri content://media --arg external_primary || true
for perm in READ_MEDIA_IMAGES READ_MEDIA_VIDEO POST_NOTIFICATIONS; do
  adb shell pm grant $PKG android.permission.$perm || true
done

adb shell screenrecord --bit-rate 6000000 --time-limit 175 /sdcard/demo.mp4 &
REC=$!
sleep 2
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
sleep 30; shot 1-open
shade 5 2-open                         # notification while the app sorts
adb shell input keyevent KEYCODE_HOME  # close the app
sleep 4; shot 3-home
shade 20 4-closed                      # sorting carries on, count goes down
sleep 25
shade 15 5-later
sleep 20
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1
sleep 25; shot 6-reopened
wait $REC
adb pull /sdcard/demo.mp4 "$OUT/organizeit-background-sorting-demo.mp4"
adb logcat -d > "$OUT/logcat.txt" || true
