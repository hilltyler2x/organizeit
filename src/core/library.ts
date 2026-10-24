import { emptyCreatedCategories } from "./storage";
import { isBannedCategoryName, resolveCategory } from "./categories";
import type { Category, Classification, Photo, Section } from "./types";

/** One photo as the device's photo library reports it. */
export interface DeviceAsset {
  id: string;
  fileName: string;
  width: number;
  height: number;
  createdAt: number;
  bytes: number;
  mimeType: string;
  isScreenshot: boolean;
}

// Pure state transitions for the photo library. The UI layer persists the results.

export interface LibraryState {
  photos: Photo[];
  categories: Category[];
}

export interface Change {
  state: LibraryState;
  putPhotos: Photo[];
  putCategories: Category[];
  deletedCategoryIds: string[];
  deletedPhotoIds: string[];
}

function finish(prev: LibraryState, photos: Photo[], categories: Category[], putPhotos: Photo[], putCategories: Category[], deletedPhotoIds: string[] = []): Change {
  // Drop AI-created categories that are now empty so the list never fills with dead tabs.
  const empty = new Set(emptyCreatedCategories(categories, photos).map((c) => c.id));
  const kept = categories.filter((c) => !empty.has(c.id));
  return {
    state: { photos, categories: kept },
    putPhotos,
    putCategories: putCategories.filter((c) => !empty.has(c.id)),
    deletedCategoryIds: prev.categories.filter((c) => empty.has(c.id)).map((c) => c.id),
    deletedPhotoIds,
  };
}

/** Below this confidence the person is asked to pick the category instead of the AI. */
export const REVIEW_BELOW = 0.6;

/**
 * Files a classified photo, creating its category if needed. Throws on catch-all names. When
 * the AI isn't confident the photo waits for the person to choose, with the AI's guess kept
 * as a suggestion; no category is created for a guess.
 */
export function applyClassification(state: LibraryState, photoId: string, result: Classification, newId: () => string, now: number = Date.now()): Change {
  if (result.confidence < REVIEW_BELOW) {
    const suggestion = isBannedCategoryName(result.category) ? undefined : { section: result.section, category: result.category };
    let updated: Photo | undefined;
    const photos = state.photos.map((p) => {
      if (p.id !== photoId) return p;
      updated = { ...p, status: "review", categoryId: undefined, label: result.label, confidence: result.confidence, suggestion, error: undefined };
      return updated;
    });
    return finish(state, photos, state.categories, updated ? [updated] : [], []);
  }
  const { category, created } = resolveCategory(state.categories, result.section, result.category, newId);
  const categories = created ? [...state.categories, category] : state.categories;
  let updated: Photo | undefined;
  const photos = state.photos.map((p) => {
    if (p.id !== photoId) return p;
    updated = { ...p, status: "sorted", categoryId: category.id, filedAt: now, label: result.label, confidence: result.confidence, suggestion: undefined, error: undefined };
    return updated;
  });
  return finish(state, photos, categories, updated ? [updated] : [], created ? [category] : []);
}

/**
 * Files several classified photos at once (one save instead of one per photo), with the same
 * rules as applyClassification. A photo with a catch-all answer is marked as an error.
 */
export function applyClassifications(state: LibraryState, results: { photoId: string; result: Classification }[], newId: () => string): Change {
  let next = state;
  const changed = new Set<string>();
  for (const { photoId, result } of results) {
    try {
      next = applyClassification(next, photoId, result, newId).state;
    } catch (err) {
      // A catch-all answer is never filed; the photo is left for the person instead.
      const error = err instanceof Error ? err.message : String(err);
      next = { ...next, photos: next.photos.map((p) => (p.id === photoId ? { ...p, status: "error", error } : p)) };
    }
    changed.add(photoId);
  }
  const before = new Set(state.categories);
  const kept = new Set(next.categories.map((c) => c.id));
  return {
    state: next,
    putPhotos: next.photos.filter((p) => changed.has(p.id)),
    putCategories: next.categories.filter((c) => !before.has(c)),
    deletedCategoryIds: state.categories.filter((c) => !kept.has(c.id)).map((c) => c.id),
    deletedPhotoIds: [],
  };
}

/**
 * Moves photos to a category, given as an existing id or as a section + name typed by the
 * user. A typed name is matched against existing categories or becomes a new one, and
 * catch-all names are rejected.
 */
export function movePhotos(
  state: LibraryState,
  photoIds: string[],
  target: { categoryId: string } | { section: Section; name: string },
  newId: () => string,
): Change {
  let category: Category;
  let created = false;
  if ("categoryId" in target) {
    const found = state.categories.find((c) => c.id === target.categoryId);
    if (!found) throw new Error("That category no longer exists.");
    category = found;
  } else {
    ({ category, created } = resolveCategory(state.categories, target.section, target.name, newId));
  }
  const ids = new Set(photoIds);
  const changed: Photo[] = [];
  const photos = state.photos.map((p) => {
    if (!ids.has(p.id)) return p;
    const next: Photo = { ...p, status: "sorted", categoryId: category.id, filedAt: undefined, suggestion: undefined, error: undefined };
    changed.push(next);
    return next;
  });
  const categories = created ? [...state.categories, category] : state.categories;
  return finish(state, photos, categories, changed, created ? [category] : []);
}

/**
 * Categories with photos the AI filed since the person last opened them, by id. These get
 * the "new" dot in the menu. Photos the person filed themselves never count as new.
 */
export function categoriesWithNew(state: LibraryState): Set<string> {
  const seenAt = new Map(state.categories.map((c) => [c.id, c.seenAt ?? 0]));
  const ids = new Set<string>();
  for (const p of state.photos) {
    if (p.status === "sorted" && p.categoryId && p.filedAt !== undefined && p.filedAt > (seenAt.get(p.categoryId) ?? Infinity)) ids.add(p.categoryId);
  }
  return ids;
}

/** Records that the person opened a category, which clears its "new" dot. */
export function markCategorySeen(state: LibraryState, categoryId: string, now: number = Date.now()): Change {
  let updated: Category | undefined;
  const categories = state.categories.map((c) => (c.id === categoryId ? (updated = { ...c, seenAt: now }) : c));
  return { state: { ...state, categories }, putPhotos: [], putCategories: updated ? [updated] : [], deletedCategoryIds: [], deletedPhotoIds: [] };
}

/** Photos waiting for the person: the AI wasn't sure, or sorting failed. */
export function needsPerson(photos: Photo[]): Photo[] {
  return photos.filter((p) => p.status === "review" || p.status === "error").sort((a, b) => b.takenAt - a.takenAt);
}

export function removePhotos(state: LibraryState, photoIds: string[]): Change {
  const ids = new Set(photoIds);
  const photos = state.photos.filter((p) => !ids.has(p.id));
  return finish(state, photos, state.categories, [], [], photoIds);
}

/** Renames a category. Merges into an existing category of the same name in that section. */
export function renameCategory(state: LibraryState, categoryId: string, name: string, newId: () => string): Change {
  const current = state.categories.find((c) => c.id === categoryId);
  if (!current) throw new Error("That category no longer exists.");
  const others = state.categories.filter((c) => c.id !== categoryId);
  const { category, created } = resolveCategory(others, current.section, name, newId);
  if (created) {
    const renamed = { ...current, name: category.name };
    const categories = state.categories.map((c) => (c.id === categoryId ? renamed : c));
    return finish(state, state.photos, categories, [], [renamed]);
  }
  // Merge: move everything into the existing category; the old one is removed when empty.
  const ids = state.photos.filter((p) => p.categoryId === categoryId).map((p) => p.id);
  return movePhotos(state, ids, { categoryId: category.id }, newId);
}

/**
 * Brings the library in line with the device: queues photos that are new on the phone and
 * drops ones that were deleted outside OrganizeIt. Photos added from files are left alone.
 */
export function syncWithDevice(state: LibraryState, assets: DeviceAsset[], newId: () => string, now: number = Date.now()): Change {
  const onDevice = new Map(assets.map((a) => [a.id, a]));
  const known = new Set<string>();
  const gone: string[] = [];
  for (const p of state.photos) {
    if (p.source.kind !== "native") continue;
    if (onDevice.has(p.source.assetId)) known.add(p.source.assetId);
    else gone.push(p.id);
  }
  const added: Photo[] = assets
    .filter((a) => !known.has(a.id))
    .map((a) => ({
      id: newId(),
      fileName: a.fileName,
      mimeType: a.mimeType,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      takenAt: a.createdAt,
      importedAt: now,
      status: "queued",
      isScreenshot: a.isScreenshot,
      source: { kind: "native", assetId: a.id },
    }));
  const goneIds = new Set(gone);
  const photos = [...state.photos.filter((p) => !goneIds.has(p.id)), ...added];
  return finish(state, photos, state.categories, added, [], gone);
}
