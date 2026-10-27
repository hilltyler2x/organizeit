import { differenceHash, makeFingerprint } from "../core/duplicates";
import type { Photo } from "../core/types";
import * as store from "./db";
import { PhotoLibrary, base64ToBlob } from "./photoLibrary";

// Works out a photo's duplicate fingerprint from a tiny copy of it. Photos from the phone's
// library are read through the native plugin at its smallest size (the same call on iPhone and
// Android); photos added from files use their stored thumbnail.

async function smallImage(photo: Photo): Promise<Blob> {
  if (photo.source.kind === "native") {
    const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: 64, quality: 0.9 });
    return base64ToBlob(data);
  }
  const thumb = (await store.getBlobs(photo.id))?.thumb;
  if (!thumb) throw new Error("Photo data is missing.");
  return thumb;
}

// Drawn at 144x128 and averaged in blocks: 16x16-pixel blocks give the 9x8 image for the hash,
// 9x8-pixel blocks the 16x16 detail. Averaging is steadier than letting the browser shrink
// straight to such small sizes.
const W = 144;
const H = 128;

export async function photoHash(photo: Photo): Promise<string> {
  const bitmap = await createImageBitmap(await smallImage(photo), { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, W, H);
  const coarse = new Float64Array(72);
  const detail = new Float64Array(256);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      coarse[Math.floor(y / 16) * 9 + Math.floor(x / 16)] += light;
      detail[Math.floor(y / 8) * 16 + Math.floor(x / 9)] += light / 72;
    }
  }
  return makeFingerprint(differenceHash(coarse), detail);
}
