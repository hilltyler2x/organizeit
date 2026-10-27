import type { Photo } from "../core/types";
import * as store from "./db";
import { decode } from "./image";
import { fullImage } from "./media";
import { PhotoLibrary } from "./photoLibrary";

// Copy and Share for one photo, like the press-and-hold menu in Photos. In the app these use
// the phone's own clipboard and share sheet on the original photo; on the website they use
// the browser's.

/** Copies a photo so it can be pasted elsewhere. */
export async function copyPhoto(photo: Photo): Promise<void> {
  if (photo.source.kind === "native") return PhotoLibrary.copyImage({ id: photo.source.assetId });
  if (photo.isVideo) throw new Error("Browsers can't copy videos. Use Share instead.");
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("This browser can't copy photos. Use Share instead.");
  }
  // Browsers only take PNG images on the clipboard. Passing a promise keeps Safari treating
  // the copy as part of the tap.
  const png = fullImage(photo).then((blob) => {
    if (!blob) throw new Error("Photo data is missing.");
    return toPng(blob);
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Opens the share sheet for a photo, or downloads it where the browser has none. */
export async function sharePhoto(photo: Photo): Promise<void> {
  if (photo.source.kind === "native") {
    await PhotoLibrary.shareImage({ id: photo.source.assetId });
    return;
  }
  const original = (await store.getBlobs(photo.id))?.original;
  if (!original) throw new Error("Photo data is missing.");
  const file = new File([original], photo.fileName, { type: original.type || photo.mimeType || "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the sheet
      throw e;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = photo.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const { bitmap } = await decode(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not copy photo."))), "image/png"),
  );
}
