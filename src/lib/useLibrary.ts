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
import type { Photo, Section } from "../core/types";
import { ApiError, classify, hasPasscode, serverStatus, unlock } from "./api";
import * as store from "./db";
import { decode, resize } from "./image";
import { classifierImage } from "./media";
import { PhotoLibrary, isNativeApp, listAllAssets, type PermissionStatus } from "./photoLibrary";
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
  const stateRef = useRef(state);
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
      let { photos, categories } = await store.loadAll();
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

  // Work through the queue a few photos at a time, newest first.
  const pump = useCallback(() => {
    if (!ai || locked) return;
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

  // Reads the phone's whole library and queues anything new. Runs on launch and whenever
  // the app comes back to the foreground.
  const scanning = useRef(false);
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
    } finally {
      setScan(null);
      scanning.current = false;
    }
  }, [commit]);

  useEffect(() => {
    if (!ready || !isNativeApp) return;
    scanDevice();
    const onVisible = () => document.visibilityState === "visible" && scanDevice();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, scanDevice]);

  const connectLibrary = useCallback(async () => {
    const { status } = await PhotoLibrary.requestPermission();
    setPermission(status);
    if (status === "granted" || status === "limited") await scanDevice();
    else if (status === "denied") await PhotoLibrary.openSettings();
  }, [scanDevice]);

  /**
   * Deletes photos. Photos from the phone's library are deleted from the phone too (the
   * system asks to confirm); returns false if the person cancels.
   */
  const remove = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    const assetIds = stateRef.current.photos
      .filter((p) => idSet.has(p.id) && p.source.kind === "native")
      .map((p) => (p.source as { assetId: string }).assetId);
    if (assetIds.length) {
      const { deleted } = await PhotoLibrary.deleteAssets({ ids: assetIds });
      if (!deleted) return false;
    }
    await commit(removePhotos(stateRef.current, ids));
    return true;
  }, [commit]);

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
    permission,
    scan,
    connectLibrary,
    openSettings: () => PhotoLibrary.openSettings(),
    unlock: async (code: string) => {
      const ok = await unlock(code);
      if (ok) setLocked(false);
      return ok;
    },
    importPhotos,
    retry,
    move: (ids: string[], target: { categoryId: string } | { section: Section; name: string }) =>
      commit(movePhotos(stateRef.current, ids, target, newId)),
    remove,
    rename: (categoryId: string, name: string) => commit(renameCategory(stateRef.current, categoryId, name, newId)),
  };
}

export type Library = ReturnType<typeof useLibrary>;
