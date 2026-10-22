import { useCallback, useEffect, useRef, useState } from "react";
import { seedCategories } from "../core/categories";
import { applyClassification, movePhotos, removePhotos, renameCategory, type Change, type LibraryState } from "../core/library";
import type { Photo, Section } from "../core/types";
import { ApiError, classify, hasPasscode, serverStatus, unlock } from "./api";
import * as store from "./db";
import { blobToBase64, decode, resize } from "./image";
import type { PickedPhoto } from "./photoSource";

const newId = () => crypto.randomUUID();
const CONCURRENCY = 3;

export function useLibrary() {
  const [state, setState] = useState<LibraryState>({ photos: [], categories: [] });
  const [ready, setReady] = useState(false);
  const [ai, setAi] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(false);
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
    serverStatus().then((s) => {
      setAi(s.ai);
      setLocked(s.passcodeRequired && !hasPasscode());
    });
  }, []);

  const classifyOne = useCallback(async (photo: Photo) => {
    await patchPhoto(photo.id, { status: "classifying", error: undefined });
    try {
      const blobs = await store.getBlobs(photo.id);
      if (!blobs) throw new Error("Photo data is missing.");
      const { bitmap } = await decode(blobs.original);
      const small = await resize(bitmap, 1024, 0.8);
      bitmap.close();
      const result = await classify({
        image: await blobToBase64(small),
        mediaType: "image/jpeg",
        fileName: photo.fileName,
        width: photo.width,
        height: photo.height,
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
      const tries = (attempts.current.get(photo.id) ?? 0) + 1;
      attempts.current.set(photo.id, tries);
      const retryable = err instanceof ApiError && err.retryable && tries < 4;
      await patchPhoto(photo.id, {
        status: retryable ? "queued" : "error",
        error: err instanceof Error ? err.message : String(err),
      });
      if (retryable) await new Promise((r) => setTimeout(r, 5000));
      if (err instanceof ApiError && err.status === 503) setAi(false);
    }
  }, [commit, patchPhoto]);

  // Work through the queue a few photos at a time.
  const pump = useCallback(() => {
    if (!ai || locked) return;
    const queued = stateRef.current.photos.filter((p) => p.status === "queued" && !running.current.has(p.id));
    for (const photo of queued.slice(0, CONCURRENCY - running.current.size)) {
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
    locked,
    unlock: async (code: string) => {
      const ok = await unlock(code);
      if (ok) setLocked(false);
      return ok;
    },
    importPhotos,
    retry,
    move: (ids: string[], target: { categoryId: string } | { section: Section; name: string }) =>
      commit(movePhotos(stateRef.current, ids, target, newId)),
    remove: (ids: string[]) => commit(removePhotos(stateRef.current, ids)),
    rename: (categoryId: string, name: string) => commit(renameCategory(stateRef.current, categoryId, name, newId)),
  };
}

export type Library = ReturnType<typeof useLibrary>;
