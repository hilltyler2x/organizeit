import { useCallback, useEffect, useRef, useState } from "react";
import { seedCategories } from "../core/categories";
import {
  applyClassifications,
  markCategorySeen,
  movePhotos,
  removePhotos,
  renameCategory,
  syncWithDevice,
  type Change,
  type LibraryState,
} from "../core/library";
import { applyBackgroundResults, backgroundQueue } from "../core/background";
import { markNotDuplicate, setHashes } from "../core/duplicates";
import { addLessons, lessonsForPrompt, lessonsFromMove } from "../core/lessons";
import { deletedNotice } from "../core/storage";
import type { Lesson, Photo, Section } from "../core/types";
import { API, ApiError, classifyBatch, currentPasscode, hasPasscode, serverStatus, unlock } from "./api";
import { BackgroundSort, type BackgroundSortStatus } from "./backgroundSort";
import * as store from "./db";
import { photoHash } from "./fingerprint";
import { decode, resize } from "./image";
import { classifierImage } from "./media";
import { readVideo } from "./video";
import { PhotoLibrary, canMakeAlbums, deviceDeleteTarget, isNativeApp, listAllAssets, type PermissionStatus } from "./photoLibrary";
import { isVideoType, type PickedPhoto } from "./photoSource";

const newId = () => crypto.randomUUID();

const ASKED_VIDEOS_KEY = "organizeit.askedForVideos";
function askedForVideos(): boolean {
  try {
    return localStorage.getItem(ASKED_VIDEOS_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberAskedForVideos() {
  try {
    localStorage.setItem(ASKED_VIDEOS_KEY, "1");
  } catch {
    // Private storage unavailable: asked again next time, which is harmless.
  }
}
// Optional cap while testing: only the newest N photos on the phone are sorted.
export const SORT_LIMIT = Number(import.meta.env.VITE_SORT_LIMIT) || 0;
// Photos go to the server several at a time, with a few requests in flight at once.
const BATCH_SIZE = 6;
const CONCURRENCY = 4;
// Duplicate fingerprints are worked out a chunk of photos at a time, alongside sorting.
const HASH_CHUNK = 40;
const HASH_CONCURRENCY = 4;

export function useLibrary() {
  const [state, setState] = useState<LibraryState>({ photos: [], categories: [] });
  const [ready, setReady] = useState(false);
  // "offline" covers both a down server and one still waking up; it is re-checked until it answers.
  const [server, setServer] = useState<"checking" | "offline" | "ok" | "no-ai">("checking");
  const [aiProblem, setAiProblem] = useState<string | null>(null);
  const ai = server === "ok" ? true : server === "no-ai" ? false : null;
  const [locked, setLocked] = useState(false);
  // Inside the iOS/Android app: photo library permission and scan progress.
  const [permission, setPermission] = useState<PermissionStatus | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [background, setBackground] = useState<BackgroundSortStatus | null>(null);
  const stateRef = useRef(state);
  const lessonsRef = useRef<Lesson[]>([]);
  const [lessonCount, setLessonCount] = useState(0);
  const running = useRef(new Set<string>());
  const batches = useRef(0);
  const attempts = useRef(new Map<string, number>());
  // Photos whose request didn't reach the server, by photo id.
  const networkFails = useRef(new Map<string, number>());
  // When recent photos finished sorting, to estimate the time left.
  const finished = useRef<number[]>([]);
  const [sortRate, setSortRate] = useState<number | null>(null);
  const [sortedThisRun, setSortedThisRun] = useState(0);

  const commit = useCallback(async (change: Change) => {
    stateRef.current = change.state;
    setState(change.state);
    await Promise.all([
      change.putPhotos.length ? store.putPhotos(change.putPhotos) : null,
      change.putCategories.length ? store.putCategories(change.putCategories) : null,
      change.deletedCategoryIds.length ? store.deleteCategories(change.deletedCategoryIds) : null,
      change.deletedPhotoIds.length ? store.deletePhotos(change.deletedPhotoIds) : null,
    ]);
  }, []);

  const patchPhoto = useCallback(async (id: string, patch: Partial<Photo>) => {
    const s = stateRef.current;
    let updated: Photo | undefined;
    const photos = s.photos.map((p) => (p.id === id ? (updated = { ...p, ...patch }) : p));
    if (!updated) return;
    await commit({ state: { ...s, photos }, putPhotos: [updated], putCategories: [], deletedCategoryIds: [], deletedPhotoIds: [] });
  }, [commit]);

  // Load from disk; seed the starting categories on first run.
  useEffect(() => {
    (async () => {
      let { photos, categories, lessons } = await store.loadAll();
      lessonsRef.current = lessons;
      setLessonCount(lessons.length);
      if (categories.length === 0) {
        categories = seedCategories(newId);
        await store.putCategories(categories);
      }
      // Anything interrupted mid-classification goes back in the queue.
      const requeue = photos.filter((p) => p.status === "classifying").map((p) => ({ ...p, status: "queued" as const }));
      if (requeue.length) {
        await store.putPhotos(requeue);
        const byId = new Map(requeue.map((p) => [p.id, p]));
        photos = photos.map((p) => byId.get(p.id) ?? p);
      }
      stateRef.current = { photos, categories };
      setState(stateRef.current);
      setReady(true);
    })();
  }, []);

  // When the server last answered. A check that fails after a newer answer is stale and is
  // ignored, so a slow check from before the app was in the background can't knock a working
  // connection back to "Connecting…".
  const lastAnswer = useRef(0);

  const serverAnswered = useCallback(() => {
    lastAnswer.current = Date.now();
    setServer((s) => (s === "checking" || s === "offline" ? "ok" : s));
  }, []);

  const checkServer = useCallback(async () => {
    const started = Date.now();
    const s = await serverStatus();
    if (!s.reachable) {
      if (lastAnswer.current < started) setServer("offline");
      return;
    }
    lastAnswer.current = Date.now();
    setServer(s.ai ? "ok" : "no-ai");
    setAiProblem(null);
    setLocked(s.passcodeRequired && !hasPasscode());
  }, []);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  // Keep trying until the server answers. This also covers a first check that never comes
  // back (iOS can freeze a request when the app goes to the background), which used to leave
  // "Connecting…" up for good.
  useEffect(() => {
    if (server !== "offline" && server !== "checking") return;
    const timer = setInterval(checkServer, 10_000);
    return () => clearInterval(timer);
  }, [server, checkServer]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && server !== "ok" && checkServer();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [server, checkServer]);

  const recordFinished = useCallback((count: number) => {
    const now = Date.now();
    const recent = finished.current.filter((t) => now - t < 120_000);
    for (let i = 0; i < count; i++) recent.push(now);
    finished.current = recent;
    setSortedThisRun((n) => n + count);
    const span = (now - recent[0]) / 1000;
    // Photos per second over the last two minutes, once there is enough to go on.
    setSortRate(recent.length >= 10 && span >= 5 ? recent.length / span : null);
  }, []);

  const markAll = useCallback(async (ids: string[], patch: (p: Photo) => Partial<Photo>) => {
    const s = stateRef.current;
    const set = new Set(ids);
    const changed: Photo[] = [];
    const photos = s.photos.map((p) => {
      if (!set.has(p.id)) return p;
      const next = { ...p, ...patch(p) };
      changed.push(next);
      return next;
    });
    await commit({ state: { ...s, photos }, putPhotos: changed, putCategories: [], deletedCategoryIds: [], deletedPhotoIds: [] });
  }, [commit]);

  const classifyGroup = useCallback(async (group: Photo[]) => {
    const ids = group.map((p) => p.id);
    await markAll(ids, () => ({ status: "classifying", error: undefined }));
    // A photo whose image can't be read fails on its own without holding up the rest.
    const images = await Promise.all(group.map((p) => classifierImage(p).then((image) => ({ image }), (err: unknown) => ({ err }))));
    const ready = group.filter((_, i) => "image" in images[i]);
    const unreadable = group.filter((_, i) => !("image" in images[i]));
    if (unreadable.length) {
      await markAll(unreadable.map((p) => p.id), (p) => {
        const err = (images[group.indexOf(p)] as { err: unknown }).err;
        return { status: "error", error: err instanceof Error ? err.message : String(err) };
      });
    }
    if (!ready.length) return;
    const started = Date.now();
    try {
      const results = await classifyBatch({
        photos: ready.map((photo) => ({
          image: (images[group.indexOf(photo)] as { image: string }).image,
          mediaType: "image/jpeg",
          fileName: photo.fileName,
          width: photo.width,
          height: photo.height,
          isScreenshot: photo.isScreenshot ?? false,
          ...(photo.isVideo ? { isVideo: true, durationSec: Math.round((photo.durationMs ?? 0) / 1000) } : {}),
        })),
        categories: stateRef.current.categories,
        lessons: lessonsForPrompt(lessonsRef.current, stateRef.current.categories),
      });
      const filed = ready.flatMap((photo, i) => {
        const r = results[i];
        return "error" in r ? [] : [{ photoId: photo.id, result: r }];
      });
      if (filed.length) await commit(applyClassifications(stateRef.current, filed, newId));
      const failed = ready.filter((_, i) => "error" in results[i]);
      if (failed.length) {
        await markAll(failed.map((p) => p.id), (p) => ({ status: "error", error: (results[ready.indexOf(p)] as { error: string }).error }));
      }
      serverAnswered();
      recordFinished(ready.length);
    } catch (err) {
      const backToQueue = () => markAll(ready.map((p) => p.id), () => ({ status: "queued", error: undefined }));
      if (err instanceof ApiError && err.status === 401) {
        // Wrong or missing passcode: wait in the queue until it is entered.
        setLocked(true);
        await backToQueue();
        return;
      }
      if (err instanceof ApiError && err.status === 0) {
        // Server unreachable: pause the queue until it answers again. If the server keeps
        // answering its health check but these photos never get through, stop retrying them
        // so one stuck photo can't hold the queue (and the banner) forever.
        // Only counted while the server is answering, so a phone with no signal never gives up.
        const serverUp = Date.now() - lastAnswer.current < 60_000;
        const fails = ready.map((p) => (networkFails.current.get(p.id) ?? 0) + (serverUp ? 1 : 0));
        ready.forEach((p, i) => networkFails.current.set(p.id, fails[i]));
        if (Math.min(...fails) >= 3) {
          await markAll(ready.map((p) => p.id), () => ({ status: "error", error: "Couldn't send this photo to the sorting server." }));
        } else {
          if (lastAnswer.current < started) setServer("offline");
          await backToQueue();
        }
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        // The server is up but can't use its Anthropic key.
        setServer("no-ai");
        setAiProblem(err.message);
        await backToQueue();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof ApiError && err.retryable;
      const tries = new Map(ready.map((p) => [p.id, (attempts.current.get(p.id) ?? 0) + 1]));
      for (const [id, n] of tries) attempts.current.set(id, n);
      await markAll(ready.map((p) => p.id), (p) =>
        retryable && tries.get(p.id)! < 4 ? { status: "queued", error: undefined } : { status: "error", error: message },
      );
      if (retryable) await new Promise((r) => setTimeout(r, 5000));
    }
  }, [commit, markAll, recordFinished, serverAnswered]);

  // Fingerprint every photo so duplicates can be spotted. Runs on its own next to sorting, a
  // chunk at a time, and picks up new photos as they arrive. A photo that couldn't be read is
  // tried again once each time the app starts (e.g. it was in iCloud with no signal).
  const hashing = useRef(false);
  const retried = useRef(new Set<string>());
  const needsHash = (p: Photo) => p.hash === undefined || (p.hash === "" && !retried.current.has(p.id));
  const [unchecked, setUnchecked] = useState(0);
  const hashPhotos = useCallback(async () => {
    if (hashing.current) return;
    hashing.current = true;
    try {
      for (;;) {
        const todo = stateRef.current.photos.filter(needsHash).sort((a, b) => b.takenAt - a.takenAt);
        setUnchecked(todo.length);
        if (!todo.length) return;
        const chunk = todo.slice(0, HASH_CHUNK);
        for (const p of chunk) retried.current.add(p.id);
        const hashes = new Map<string, string>();
        for (let i = 0; i < chunk.length; i += HASH_CONCURRENCY) {
          await Promise.all(
            chunk.slice(i, i + HASH_CONCURRENCY).map((p) =>
              photoHash(p).then((h) => hashes.set(p.id, h), () => hashes.set(p.id, "")),
            ),
          );
        }
        // Photos deleted while this chunk was read are simply not found.
        await commit(setHashes(stateRef.current, hashes));
      }
    } finally {
      hashing.current = false;
    }
  }, [commit]);

  useEffect(() => {
    if (ready && state.photos.some(needsHash)) hashPhotos();
  }, [ready, state, hashPhotos]);

  // Reading the phone's library also collects what was sorted while the app was closed, so
  // the queue waits for it rather than sorting those photos a second time.
  const scanning = useRef(false);
  // Until the library has been read once, the app can't tell the phone which photos are new.
  const scanned = useRef(false);

  // Work through the queue newest first, a batch of photos per request and a few requests
  // at a time.
  const pump = useCallback(() => {
    if (!ai || locked || scanning.current) return;
    const free = CONCURRENCY - batches.current;
    if (free <= 0) return;
    const queued = stateRef.current.photos
      .filter((p) => p.status === "queued" && !running.current.has(p.id))
      .sort((a, b) => b.takenAt - a.takenAt)
      .slice(0, free * BATCH_SIZE);
    for (let i = 0; i < queued.length; i += BATCH_SIZE) {
      const group = queued.slice(i, i + BATCH_SIZE);
      batches.current++;
      for (const p of group) running.current.add(p.id);
      classifyGroup(group).finally(() => {
        batches.current--;
        for (const p of group) running.current.delete(p.id);
        pump();
      });
    }
  }, [ai, locked, classifyGroup]);

  // Once the queue is empty, the next round of sorting starts its progress from zero.
  const idle = !state.photos.some((p) => p.status === "queued" || p.status === "classifying");
  useEffect(() => {
    if (!idle) return;
    finished.current = [];
    setSortedThisRun(0);
    setSortRate(null);
  }, [idle]);

  useEffect(() => {
    if (ready) pump();
  }, [ready, pump, state]);

  // Reads the phone's whole library and queues anything new, then files whatever the phone
  // sorted in the background. Runs on launch, whenever the app comes back to the foreground,
  // and as soon as a photo is added while it is open. A change during a scan scans again after.
  const rescan = useRef(false);
  const scanDevice = useCallback(async (): Promise<void> => {
    if (!isNativeApp) return;
    if (scanning.current) {
      rescan.current = true;
      return;
    }
    scanning.current = true;
    rescan.current = false;
    try {
      let { status, videos } = await PhotoLibrary.checkPermission();
      // Android asks for photos and videos separately. Someone who allowed photos before
      // videos were sorted too is asked once for videos.
      if (status === "granted" && videos === false && !askedForVideos()) {
        rememberAskedForVideos();
        ({ status } = await PhotoLibrary.requestPermission());
      }
      setPermission(status);
      if (status !== "granted" && status !== "limited") return;
      setScan({ done: 0, total: 0 });
      let assets = await listAllAssets((done, total) => setScan({ done, total }));
      if (SORT_LIMIT) assets = assets.sort((a, b) => b.createdAt - a.createdAt).slice(0, SORT_LIMIT);
      await commit(syncWithDevice(stateRef.current, assets, newId));
      const { results } = await BackgroundSort.takeResults().catch(() => ({ results: [] }));
      if (results.length) await commit(applyBackgroundResults(stateRef.current, results, newId));
      scanned.current = true;
      BackgroundSort.status().then(setBackground, () => setBackground(null));
    } finally {
      setScan(null);
      scanning.current = false;
      pump();
    }
    if (rescan.current) return scanDevice();
  }, [commit, pump]);

  useEffect(() => {
    if (!ready || !isNativeApp) return;
    scanDevice();
    const onVisible = () => document.visibilityState === "visible" && scanDevice();
    document.addEventListener("visibilitychange", onVisible);
    // New photo taken (or one deleted) while the app is open: sort it right away. Changes
    // arriving close together (a burst of shots) are gathered into one scan.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = PhotoLibrary.addListener("libraryChanged", () => {
      clearTimeout(timer);
      timer = setTimeout(scanDevice, 1500);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
      listener.then((l) => l.remove(), () => undefined);
    };
  }, [ready, scanDevice]);

  // Hand the phone what it needs to keep sorting once the app is closed: the queue, the
  // categories and the lessons. Sent shortly after anything changes, and right away when the
  // app is being closed.
  const syncBackground = useCallback(() => {
    if (!isNativeApp || !API || !scanned.current) return;
    const s = stateRef.current;
    BackgroundSort.configure({
      apiUrl: API,
      passcode: currentPasscode(),
      categories: s.categories.map((c) => ({ section: c.section, name: c.name })),
      lessons: lessonsForPrompt(lessonsRef.current, s.categories),
      ...backgroundQueue(s),
    }).catch((err) => console.warn("Background sorting is unavailable:", err));
  }, []);

  useEffect(() => {
    if (!ready || !isNativeApp) return;
    const timer = setTimeout(syncBackground, 1500);
    return () => clearTimeout(timer);
  }, [ready, state, lessonCount, locked, syncBackground]);

  useEffect(() => {
    if (!isNativeApp) return;
    const onHidden = () => document.visibilityState === "hidden" && syncBackground();
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [syncBackground]);

  const connectLibrary = useCallback(async () => {
    const { status } = await PhotoLibrary.requestPermission();
    setPermission(status);
    if (status === "granted" || status === "limited") await scanDevice();
    else if (status === "denied") await PhotoLibrary.openSettings();
  }, [scanDevice]);

  // With "Limited" (iPhone) or "Selected photos" (Android 14+) access the app only sees part of
  // the library. Android shows its permission dialog again, with "Allow all"; iPhone only lets
  // the person change it in Settings. Either way the library is read again once they come back.
  const allowFullAccess = useCallback(async () => {
    if (deviceDeleteTarget === "android") {
      const { status } = await PhotoLibrary.requestPermission();
      setPermission(status);
      if (status === "granted" || status === "limited") await scanDevice();
      if (status === "granted") return;
    }
    await PhotoLibrary.openSettings();
  }, [scanDevice]);

  /**
   * Deletes photos. Photos from the phone's library are deleted from the phone too (the
   * system asks to confirm). Returns the note to show, or null if the person cancels.
   */
  const remove = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    const chosen = stateRef.current.photos.filter((p) => idSet.has(p.id));
    const assetIds = chosen
      .filter((p) => p.source.kind === "native")
      .map((p) => (p.source as { assetId: string }).assetId);
    if (assetIds.length) {
      const { deleted } = await PhotoLibrary.deleteAssets({ ids: assetIds });
      if (!deleted) return null;
    }
    await commit(removePhotos(stateRef.current, ids));
    const target = assetIds.length ? deviceDeleteTarget : "organizeit";
    const videos = chosen.filter((p) => p.isVideo).length;
    return deletedNotice(chosen.length, chosen.reduce((n, p) => n + p.bytes, 0), target, videos);
  }, [commit]);

  /** The person says photos flagged as duplicates are not copies of each other. */
  const keepAll = useCallback(async (ids: string[]) => {
    await commit(markNotDuplicate(stateRef.current, ids));
  }, [commit]);

  /** Clears a category's "new" dot once the person has opened it. */
  const markSeen = useCallback(async (categoryId: string) => {
    await commit(markCategorySeen(stateRef.current, categoryId));
  }, [commit]);

  /** Puts photos from the phone's library into a Photos album (iPhone app only). */
  const addToAlbum = useCallback(async (ids: string[], title: string) => {
    const idSet = new Set(ids);
    const assetIds = stateRef.current.photos
      .filter((p) => idSet.has(p.id) && p.source.kind === "native")
      .map((p) => (p.source as { assetId: string }).assetId);
    if (!assetIds.length) throw new Error("Only photos from your phone's library can go into an album.");
    return PhotoLibrary.addToAlbum({ ids: assetIds, title });
  }, []);

  const importPhotos = useCallback(async (picked: PickedPhoto[]) => {
    for (const item of picked) {
      try {
        const video = isVideoType(item.type) ? await readVideo(item.file, 480) : null;
        let size: { width: number; height: number };
        let thumb: Blob;
        if (video) {
          size = video;
          thumb = video.poster;
        } else {
          const { width, height, bitmap } = await decode(item.file);
          size = { width, height };
          thumb = await resize(bitmap, 480, 0.78);
          bitmap.close();
        }
        const photo: Photo = {
          id: newId(),
          fileName: item.name,
          mimeType: item.type,
          bytes: item.file.size,
          width: size.width,
          height: size.height,
          takenAt: item.lastModified,
          importedAt: Date.now(),
          status: "queued",
          ...(video ? { isVideo: true, durationMs: video.durationMs } : {}),
          source: item.source,
        };
        await store.addPhoto(photo, item.file, thumb);
        const s = stateRef.current;
        stateRef.current = { ...s, photos: [...s.photos, photo] };
        setState(stateRef.current);
      } catch {
        console.warn(`Skipped ${item.name}: this browser cannot read that format.`);
      }
    }
  }, []);

  /** Moves photos and remembers any correction so later sorts get it right on their own. */
  const move = useCallback(async (ids: string[], target: { categoryId: string } | { section: Section; name: string }) => {
    const before = stateRef.current;
    const change = movePhotos(before, ids, target, newId);
    await commit(change);
    const learned = lessonsFromMove(before, change.state, ids, newId);
    if (!learned.length) return;
    const { lessons, dropped } = addLessons(lessonsRef.current, learned);
    lessonsRef.current = lessons;
    setLessonCount(lessons.length);
    const keep = new Set(lessons.map((l) => l.id));
    await store.saveLessons(learned.filter((l) => keep.has(l.id)), [...dropped, ...learned.filter((l) => !keep.has(l.id)).map((l) => l.id)]);
  }, [commit]);

  const retry = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      attempts.current.delete(id);
      networkFails.current.delete(id);
    }
    await markAll(ids, () => ({ status: "queued", error: undefined }));
  }, [markAll]);

  return {
    ...state,
    ready,
    ai,
    server,
    aiProblem,
    locked,
    native: isNativeApp,
    canMakeAlbums,
    permission,
    scan,
    /** Photos per second lately, or null until there is enough to estimate. */
    sortRate,
    sortedThisRun,
    background,
    connectLibrary,
    openSettings: () => PhotoLibrary.openSettings(),
    allowFullAccess,
    unlock: async (code: string) => {
      const ok = await unlock(code);
      if (ok) setLocked(false);
      return ok;
    },
    importPhotos,
    retry,
    move,
    lessonCount,
    remove,
    addToAlbum,
    markSeen,
    keepAll,
    /** Photos not yet checked for duplicates. */
    unchecked,
    rename: (categoryId: string, name: string) => commit(renameCategory(stateRef.current, categoryId, name, newId)),
  };
}

export type Library = ReturnType<typeof useLibrary>;
