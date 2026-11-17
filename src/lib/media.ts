import { Capacitor } from "@capacitor/core";
import type { Photo } from "../core/types";
import * as store from "./db";
import { blobToBase64, decode, resize } from "./image";
import { PhotoLibrary, base64ToBlob } from "./photoLibrary";
import { VIDEO_SHEET_SIDE, frameSheet } from "./video";
import { CLASSIFIER_QUALITY, classifierSide } from "./quality";

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
 * A full-quality JPEG, base64-encoded, for the classifier: as large as the AI can see (see
 * quality.ts), never upscaled. A video is sent as six frames from across the clip in one grid
 * image of the same size, so each frame is still sharp. The original stays on the phone.
 */
export async function classifierImage(photo: Photo): Promise<string> {
  if (photo.source.kind === "native") {
    const maxSide = photo.isVideo ? VIDEO_SHEET_SIDE : classifierSide(photo.width, photo.height);
    return (await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide, quality: CLASSIFIER_QUALITY, frames: photo.isVideo })).data;
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error(photo.isVideo ? "Video data is missing." : "Photo data is missing.");
  if (photo.isVideo) return blobToBase64(await frameSheet(original, VIDEO_SHEET_SIDE, CLASSIFIER_QUALITY));
  const { bitmap } = await decode(original);
  const sized = await resize(bitmap, classifierSide(bitmap.width, bitmap.height), CLASSIFIER_QUALITY);
  bitmap.close();
  return blobToBase64(sized);
}
