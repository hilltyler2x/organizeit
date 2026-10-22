import type { Photo } from "../core/types";
import * as store from "./db";
import { blobToBase64, decode, resize } from "./image";
import { PhotoLibrary, base64ToBlob } from "./photoLibrary";

// Image access for both kinds of photo. Photos from the phone's library are read in place
// through the native plugin (only a small thumbnail is cached); photos added from files
// keep their original in IndexedDB.

export async function thumbnail(photo: Photo): Promise<Blob | undefined> {
  const cached = await store.getBlobs(photo.id);
  if (cached?.thumb) return cached.thumb;
  if (photo.source.kind !== "native") return undefined;
  const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 480, quality: 0.75 });
  const thumb = base64ToBlob(data);
  await store.putThumb(photo.id, thumb);
  return thumb;
}

export async function fullImage(photo: Photo): Promise<Blob | undefined> {
  if (photo.source.kind === "native") {
    const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 2048, quality: 0.9 });
    return base64ToBlob(data);
  }
  return (await store.getBlobs(photo.id))?.original;
}

/** A ~1024px JPEG, base64-encoded, for the classifier. */
export async function classifierImage(photo: Photo): Promise<string> {
  if (photo.source.kind === "native") {
    return (await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 1024, quality: 0.8 })).data;
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error("Photo data is missing.");
  const { bitmap } = await decode(original);
  const small = await resize(bitmap, 1024, 0.8);
  bitmap.close();
  return blobToBase64(small);
}
