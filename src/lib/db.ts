import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Category, Lesson, Photo } from "../core/types";

// On-device storage for the library index: photo records, categories and thumbnails.

interface OrganizeItDB extends DBSchema {
  photos: { key: string; value: Photo; indexes: { byCategory: string } };
  // `original` is only kept for photos added from files; library photos are read in place.
  blobs: { key: string; value: { id: string; original?: Blob; thumb: Blob } };
  categories: { key: string; value: Category };
  // Corrections the person made, used to teach the classifier.
  lessons: { key: string; value: Lesson };
}

let dbPromise: Promise<IDBPDatabase<OrganizeItDB>> | null = null;

function db() {
  dbPromise ??= openDB<OrganizeItDB>("organizeit", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const photos = d.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("byCategory", "categoryId");
        d.createObjectStore("blobs", { keyPath: "id" });
        d.createObjectStore("categories", { keyPath: "id" });
      }
      if (oldVersion < 2) d.createObjectStore("lessons", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function loadAll(): Promise<{ photos: Photo[]; categories: Category[]; lessons: Lesson[] }> {
  const d = await db();
  const [photos, categories, lessons] = await Promise.all([d.getAll("photos"), d.getAll("categories"), d.getAll("lessons")]);
  return { photos, categories, lessons };
}

export async function saveLessons(put: Lesson[], deleteIds: string[]) {
  const tx = (await db()).transaction("lessons", "readwrite");
  await Promise.all([...put.map((l) => tx.store.put(l)), ...deleteIds.map((id) => tx.store.delete(id)), tx.done]);
}

export async function putCategories(categories: Category[]) {
  const tx = (await db()).transaction("categories", "readwrite");
  await Promise.all([...categories.map((c) => tx.store.put(c)), tx.done]);
}

export async function deleteCategories(ids: string[]) {
  const tx = (await db()).transaction("categories", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function addPhoto(photo: Photo, original: Blob, thumb: Blob) {
  const tx = (await db()).transaction(["photos", "blobs"], "readwrite");
  await Promise.all([
    tx.objectStore("photos").put(photo),
    tx.objectStore("blobs").put({ id: photo.id, original, thumb }),
    tx.done,
  ]);
}

export async function putPhotos(photos: Photo[]) {
  const tx = (await db()).transaction("photos", "readwrite");
  await Promise.all([...photos.map((p) => tx.store.put(p)), tx.done]);
}

export async function deletePhotos(ids: string[]) {
  const tx = (await db()).transaction(["photos", "blobs"], "readwrite");
  await Promise.all([
    ...ids.flatMap((id) => [tx.objectStore("photos").delete(id), tx.objectStore("blobs").delete(id)]),
    tx.done,
  ]);
}

export async function putThumb(id: string, thumb: Blob) {
  const d = await db();
  const existing = await d.get("blobs", id);
  await d.put("blobs", { ...existing, id, thumb });
}

export async function getBlobs(id: string) {
  return (await db()).get("blobs", id);
}
