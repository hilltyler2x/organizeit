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

// The close look: two look-alikes compared at full detail, so a receipt with another order
// number or a different amount is never taken for a copy. Both are brought to the same size (the
// smaller of the two, at most 768 pixels wide) and compared in 8x8-pixel squares. In each square
// it counts the pixels that clearly differ (by 40% of full brightness or more): re-saving or
// resizing a photo blurs edges a little but leaves no such pixels, while a changed digit, a moved
// hand or a different word leaves a cluster of them.
const CLOSE_SIDE = 1024;
const CLOSE_WIDTH = 768;
const SQUARE = 8;
const CLEAR_DIFFERENCE = 0.4;
/** Most clearly different pixels a square may have for two photos to count as copies. */
export const MAX_CHANGED_PIXELS = 3;

async function closeImage(photo: Photo): Promise<ImageBitmap> {
  if (photo.source.kind === "native") {
    const { data } = await PhotoLibrary.getImage({ id: photo.source.assetId, maxSide: CLOSE_SIDE, quality: 0.9 });
    return createImageBitmap(base64ToBlob(data));
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error("Photo data is missing.");
  return createImageBitmap(original, { imageOrientation: "from-image" });
}

async function grayscale(bitmap: ImageBitmap, w: number, h: number): Promise<Float32Array> {
  // Shrunk by the browser's image decoder rather than by drawing, which on some browsers skips
  // pixels and turns small text into noise.
  const small = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(small, 0, 0);
  small.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  return out;
}

/** True when two look-alike photos are the same picture down to the detail. */
export async function sameInDetail(a: Photo, b: Photo): Promise<boolean> {
  return (await mostChangedPixels(a, b)) <= MAX_CHANGED_PIXELS;
}

/** The most clearly different pixels in any 8x8 square of two photos (0 for copies). */
export async function mostChangedPixels(a: Photo, b: Photo): Promise<number> {
  const [ia, ib] = await Promise.all([closeImage(a), closeImage(b)]);
  try {
    const w = Math.min(CLOSE_WIDTH, ia.width, ib.width);
    const h = Math.max(SQUARE, Math.round((w * ia.height) / ia.width));
    const [ga, gb] = await Promise.all([grayscale(ia, w, h), grayscale(ib, w, h)]);
    let worst = 0;
    for (let y = 0; y + SQUARE <= h; y += SQUARE) {
      for (let x = 0; x + SQUARE <= w; x += SQUARE) {
        let changed = 0;
        for (let dy = 0; dy < SQUARE; dy++) {
          for (let dx = 0; dx < SQUARE; dx++) {
            const i = (y + dy) * w + x + dx;
            if (Math.abs(ga[i] - gb[i]) >= CLEAR_DIFFERENCE) changed++;
          }
        }
        worst = Math.max(worst, changed);
      }
    }
    return worst;
  } finally {
    ia.close();
    ib.close();
  }
}
