import { emptyCreatedCategories } from "./storage";
import { resolveCategory } from "./categories";
import type { Category, Classification, Photo, Section } from "./types";

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

/** Files a classified photo, creating its category if needed. Throws on catch-all names. */
export function applyClassification(state: LibraryState, photoId: string, result: Classification, newId: () => string): Change {
  const { category, created } = resolveCategory(state.categories, result.section, result.category, newId);
  const categories = created ? [...state.categories, category] : state.categories;
  let updated: Photo | undefined;
  const photos = state.photos.map((p) => {
    if (p.id !== photoId) return p;
    updated = { ...p, status: "sorted", categoryId: category.id, label: result.label, confidence: result.confidence, error: undefined };
    return updated;
  });
  return finish(state, photos, categories, updated ? [updated] : [], created ? [category] : []);
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
    const next: Photo = { ...p, status: "sorted", categoryId: category.id, error: undefined };
    changed.push(next);
    return next;
  });
  const categories = created ? [...state.categories, category] : state.categories;
  return finish(state, photos, categories, changed, created ? [category] : []);
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
