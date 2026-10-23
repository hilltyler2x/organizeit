import { applyClassification, type Change, type DeviceAsset, type LibraryState } from "./library";
import type { Classification, Photo } from "./types";

// Sorting while the app is closed. The phone's own code (native/photo-library) sorts photos
// in the background from a snapshot the app hands it, and keeps the answers until the app is
// opened again. These helpers build that snapshot and fold the answers back in.

/** At most this many queued photos are handed over, newest first. */
export const MAX_BACKGROUND_QUEUE = 5000;

/** A photo the phone sorted while the app was closed. */
export interface BackgroundResult {
  asset: DeviceAsset;
  result: Classification;
}

/**
 * Which phone photos still need sorting (newest first), and the creation time of the newest
 * phone photo the app knows about: anything newer than that is new since the app last looked.
 */
export function backgroundQueue(state: LibraryState): { queued: string[]; knownUpTo: number } {
  const native = state.photos.filter((p): p is Photo & { source: { kind: "native"; assetId: string } } => p.source.kind === "native");
  const queued = native
    .filter((p) => p.status === "queued" || p.status === "classifying")
    .sort((a, b) => b.takenAt - a.takenAt)
    .slice(0, MAX_BACKGROUND_QUEUE)
    .map((p) => p.source.assetId);
  const knownUpTo = native.reduce((max, p) => Math.max(max, p.takenAt), 0);
  return { queued, knownUpTo };
}

/**
 * Files photos that were sorted in the background. Only photos still waiting are touched: one
 * the app is sorting right now, or that the person already filed, keeps what it has. Results
 * for photos the app doesn't know (deleted since) are dropped.
 */
export function applyBackgroundResults(state: LibraryState, results: BackgroundResult[], newId: () => string): Change {
  const byAsset = new Map<string, string>();
  for (const p of state.photos) {
    if (p.source.kind === "native" && (p.status === "queued" || p.status === "error")) byAsset.set(p.source.assetId, p.id);
  }
  let current = state;
  const putPhotos = new Map<string, Photo>();
  const putCategories = new Map<string, LibraryState["categories"][number]>();
  const deleted = new Set<string>();
  for (const { asset, result } of results) {
    const photoId = byAsset.get(asset.id);
    if (!photoId) continue;
    byAsset.delete(asset.id);
    const change = applyClassification(current, photoId, result, newId);
    current = change.state;
    change.putPhotos.forEach((p) => putPhotos.set(p.id, p));
    change.putCategories.forEach((c) => putCategories.set(c.id, c));
    change.deletedCategoryIds.forEach((id) => deleted.add(id));
  }
  const kept = new Set(current.categories.map((c) => c.id));
  return {
    state: current,
    putPhotos: [...putPhotos.values()],
    putCategories: [...putCategories.values()].filter((c) => kept.has(c.id)),
    deletedCategoryIds: [...deleted].filter((id) => !kept.has(id)),
    deletedPhotoIds: [],
  };
}
