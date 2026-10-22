import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Category, Photo } from "../core/types";

// On-device storage for the web build. A native build swaps this for its own
// implementation of the same functions.

interface OrganizeItDB extends DBSchema {
  photos: { key: string; value: Photo; indexes: { byCategory: string } };
  blobs: { key: string; value: { id: string; original: Blob; thumb: Blob } };
  categories: { key: string; value: Category };
}

let dbPromise: Promise<IDBPDatabase<OrganizeItDB>> | null = null;

function db() {
  dbPromise ??= openDB<OrganizeItDB>("organizeit", 1, {
    upgrade(d) {
      const photos = d.createObjectStore("photos", { keyPath: "id" });
      photos.createIndex("byCategory", "categoryId");
      d.createObjectStore("blobs", { keyPath: "id" });
      d.createObjectStore("categories", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function loadAll(): Promise<{ photos: Photo[]; categories: Category[] }> {
  const d = await db();
  const [photos, categories] = await Promise.all([d.getAll("photos"), d.getAll("categories")]);
  return { photos, categories };
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

export async function getBlobs(id: string) {
  return (await db()).get("blobs", id);
}
