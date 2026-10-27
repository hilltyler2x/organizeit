import { Capacitor } from "@capacitor/core";
import type { Photo } from "../core/types";
import * as store from "./db";
import { blobToBase64, decode, resize } from "./image";
import { PhotoLibrary, base64ToBlob } from "./photoLibrary";
import { frameSheet } from "./video";

// Image access for both kinds of photo. Photos from the phone's library are read in place
// through the native plugin (only a small thumbnail is cached); photos added from files
// keep their original in IndexedDB.

const CLASSIFIER_SIDE = 768;

export async function thumbnail(photo: Photo): Promise<Blob | undefined> {
  const cached = await store.getBlobs(photo.id);
  if (cached?.thumb) return cached.thumb;
  if (photo.source.kind !== "native") return undefined;
  const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 480, quality: 0.75 });
  const thumb = base64ToBlob(data);
  await store.putThumb(photo.id, thumb);
  return thumb;
}

/** A large still: the photo itself, or a video's opening frame. */
export async function fullImage(photo: Photo): Promise<Blob | undefined> {
  if (photo.isVideo) return thumbnail(photo);
  if (photo.source.kind === "native") {
    const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 2048, quality: 0.9 });
    return base64ToBlob(data);
  }
  return (await store.getBlobs(photo.id))?.original;
}

/** A URL the viewer can play a video from. Call `release` once it is no longer shown. */
export async function videoSource(photo: Photo): Promise<{ url: string; release: () => void }> {
  if (photo.source.kind === "native") {
    const { path } = await PhotoLibrary.getVideo({ id: photo.source.assetId });
    return { url: Capacitor.convertFileSrc(path), release: () => {} };
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error("Video data is missing.");
  const url = URL.createObjectURL(original);
  return { url, release: () => URL.revokeObjectURL(url) };
}

/**
 * A ~768px JPEG, base64-encoded, for the classifier. That is plenty to tell a receipt from a
 * sneaker, and about half the upload and AI reading time of 1024px. A video is sent as four
 * frames from across the clip in one 2×2 image.
 */
export async function classifierImage(photo: Photo): Promise<string> {
  if (photo.source.kind === "native") {
    return (await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: CLASSIFIER_SIDE, quality: 0.8, frames: photo.isVideo })).data;
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error(photo.isVideo ? "Video data is missing." : "Photo data is missing.");
  if (photo.isVideo) return blobToBase64(await frameSheet(original, CLASSIFIER_SIDE));
  const { bitmap } = await decode(original);
  const small = await resize(bitmap, CLASSIFIER_SIDE, 0.8);
  bitmap.close();
  return blobToBase64(small);
}
