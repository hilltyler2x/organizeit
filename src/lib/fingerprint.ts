import { differenceHash } from "../core/duplicates";
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

// Drawn at 36x32 and averaged in 4x4 blocks down to 9x8, which is steadier than letting the
// browser shrink straight to 9x8.
const W = 36;
const H = 32;

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
  const grid = new Float64Array(72);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      grid[Math.floor(y / 4) * 9 + Math.floor(x / 4)] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  return differenceHash(grid);
}
