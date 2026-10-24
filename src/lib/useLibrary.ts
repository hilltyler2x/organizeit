import { useCallback, useEffect, useRef, useState } from "react";
import { seedCategories } from "../core/categories";
import {
  applyClassification,
  movePhotos,
  removePhotos,
  renameCategory,
  syncWithDevice,
  type Change,
  type LibraryState,
} from "../core/library";
import { applyBackgroundResults, backgroundQueue } from "../core/background";
import { addLessons, lessonsForPrompt, lessonsFromMove } from "../core/lessons";
import { deletedNotice } from "../core/storage";
import type { Lesson, Photo, Section } from "../core/types";
import { API, ApiError, classify, currentPasscode, hasPasscode, serverStatus, unlock } from "./api";
import { BackgroundSort, type BackgroundSortStatus } from "./backgroundSort";
import * as store from "./db";
import { decode, resize } from "./image";
import { classifierImage } from "./media";
import { PhotoLibrary, canMakeAlbums, deviceDeleteTarget, isNativeApp, listAllAssets, type PermissionStatus } from "./photoLibrary";
import type { PickedPhoto } from "./photoSource";

const newId = () => crypto.randomUUID();
// Optional cap while testing: only the newest N photos on the phone are sorted.
export const SORT_LIMIT = Number(import.meta.env.VITE_SORT_LIMIT) || 0;
const CONCURRENCY = 3;

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
  const attempts = useRef(new Map<string, number>());

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

  const checkServer = useCallback(async () => {
    const s = await serverStatus();
    if (!s.reachable) {
      setServer("offline");
      return;
    }
    setServer(s.ai ? "ok" : "no-ai");
    setAiProblem(null);
    setLocked(s.passcodeRequired && !hasPasscode());
  }, []);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  // Keep trying while the server is unreachable, and check again when the app comes back.
  useEffect(() => {
    if (server !== "offline") return;
    const timer = setTimeout(checkServer, 10_000);
    return () => clearTimeout(timer);
  }, [server, checkServer]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && server !== "ok" && checkServer();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [server, checkServer]);

  const classifyOne = useCallback(async (photo: Photo) => {
    await patchPhoto(photo.id, { status: "classifying", error: undefined });
    try {
      const result = await classify({
        image: await classifierImage(photo),
        mediaType: "image/jpeg",
        fileName: photo.fileName,
        width: photo.width,
        height: photo.height,
        isScreenshot: photo.isScreenshot ?? false,
        categories: stateRef.current.categories,
        lessons: lessonsForPrompt(lessonsRef.current, stateRef.current.categories),
      });
      await commit(applyClassification(stateRef.current, photo.id, result, newId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Wrong or missing passcode: wait in the queue until it is entered.
        setLocked(true);
        await patchPhoto(photo.id, { status: "queued", error: undefined });
        return;
      }
      if (err instanceof ApiError && err.status === 0) {
        // Server unreachable: pause the queue until it answers again.
        setServer("offline");
        await patchPhoto(photo.id, { status: "queued", error: undefined });
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        // The server is up but can't use its Anthropic key.
        setServer("no-ai");
        setAiProblem(err.message);
        await patchPhoto(photo.id, { status: "queued", error: undefined });
        return;
      }
      const tries = (attempts.current.get(photo.id) ?? 0) + 1;
      attempts.current.set(photo.id, tries);
      const retryable = err instanceof ApiError && err.retryable && tries < 4;
      await patchPhoto(photo.id, {
        status: retryable ? "queued" : "error",
        error: err instanceof Error ? err.message : String(err),
      });
      if (retryable) await new Promise((r) => setTimeout(r, 5000));
    }
  }, [commit, patchPhoto]);

  // Reading the phone's library also collects what was sorted while the app was closed, so
  // the queue waits for it rather than sorting those photos a second time.
  const scanning = useRef(false);
  // Until the library has been read once, the app can't tell the phone which photos are new.
  const scanned = useRef(false);

  // Work through the queue a few photos at a time, newest first.
  const pump = useCallback(() => {
    if (!ai || locked || scanning.current) return;
    const free = CONCURRENCY - running.current.size;
    if (free <= 0) return;
    const queued = stateRef.current.photos
      .filter((p) => p.status === "queued" && !running.current.has(p.id))
      .sort((a, b) => b.takenAt - a.takenAt);
    for (const photo of queued.slice(0, free)) {
      running.current.add(photo.id);
      classifyOne(photo).finally(() => {
        running.current.delete(photo.id);
        pump();
      });
    }
  }, [ai, locked, classifyOne]);

  useEffect(() => {
    if (ready) pump();
  }, [ready, pump, state]);

  // Reads the phone's whole library and queues anything new, then files whatever the phone
  // sorted in the background. Runs on launch and whenever the app comes back to the foreground.
  const scanDevice = useCallback(async () => {
    if (!isNativeApp || scanning.current) return;
    scanning.current = true;
    try {
      const { status } = await PhotoLibrary.checkPermission();
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
  }, [commit, pump]);

  useEffect(() => {
    if (!ready || !isNativeApp) return;
    scanDevice();
    const onVisible = () => document.visibilityState === "visible" && scanDevice();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
    return deletedNotice(chosen.length, chosen.reduce((n, p) => n + p.bytes, 0), target);
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
        const { width, height, bitmap } = await decode(item.file);
        const thumb = await resize(bitmap, 480, 0.78);
        bitmap.close();
        const photo: Photo = {
          id: newId(),
          fileName: item.name,
          mimeType: item.type,
          bytes: item.file.size,
          width,
          height,
          takenAt: item.lastModified,
          importedAt: Date.now(),
          status: "queued",
          source: item.source,
        };
        await store.addPhoto(photo, item.file, thumb);
        const s = stateRef.current;
        stateRef.current = { ...s, photos: [...s.photos, photo] };
        setState(stateRef.current);
      } catch {
        console.warn(`Skipped ${item.name}: this browser cannot read that image format.`);
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
      await patchPhoto(id, { status: "queued", error: undefined });
    }
  }, [patchPhoto]);

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
    background,
    connectLibrary,
    openSettings: () => PhotoLibrary.openSettings(),
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
    rename: (categoryId: string, name: string) => commit(renameCategory(stateRef.current, categoryId, name, newId)),
  };
}

export type Library = ReturnType<typeof useLibrary>;
