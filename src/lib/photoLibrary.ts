import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { DeviceAsset } from "../core/library";
import type { DeleteTarget } from "../core/storage";

// Bridge to the native photo library plugin in native/photo-library (iOS PhotoKit,
// Android MediaStore). Only available inside the iOS/Android app.

export type PermissionStatus = "granted" | "limited" | "denied" | "prompt";

interface PhotoLibraryPlugin {
  /** `videos` is false on Android when photos are allowed but videos aren't (yet). */
  checkPermission(): Promise<{ status: PermissionStatus; videos?: boolean }>;
  requestPermission(): Promise<{ status: PermissionStatus; videos?: boolean }>;
  openSettings(): Promise<void>;
  list(options: { offset: number; limit: number }): Promise<{ assets: DeviceAsset[]; total: number; nextOffset: number | null }>;
  /**
   * A JPEG of a photo, or of a video's opening frame. With `frames`, a video comes back as four
   * frames from across the clip in a 2×2 grid instead, for sorting.
   */
  getImage(options: { id: string; maxSide: number; quality?: number; frames?: boolean }): Promise<{ data: string; width: number; height: number }>;
  /** Where a video can be played from: a file path (iOS) or content URI (Android). */
  getVideo(options: { id: string }): Promise<{ path: string }>;
  deleteAssets(options: { ids: string[] }): Promise<{ deleted: boolean }>;
  /** Fires the moment photos are added to or removed from the library while the app runs. */
  addListener(event: "libraryChanged", listener: (info: { added?: number }) => void): Promise<PluginListenerHandle>;
  /** iOS only. Adds photos to a Photos album, creating it if needed. */
  addToAlbum(options: { ids: string[]; title: string }): Promise<{ added: number; title: string; created: boolean }>;
  /** Copies a photo to the clipboard so it can be pasted into other apps. */
  copyImage(options: { id: string }): Promise<void>;
  /** Opens the phone's share sheet for a photo. */
  shareImage(options: { id: string }): Promise<{ completed: boolean }>;
}

export const PhotoLibrary = registerPlugin<PhotoLibraryPlugin>("PhotoLibrary");

export const isNativeApp = Capacitor.isNativePlatform();

/** Whether photos can be put into a Photos album (the iPhone app only, for now). */
export const canMakeAlbums = Capacitor.getPlatform() === "ios";

/** Where photos from the phone's library go when deleted. */
export const deviceDeleteTarget: DeleteTarget = Capacitor.getPlatform() === "android" ? "android" : "ios";

/** Reads the metadata of every photo on the device, in pages. */
export async function listAllAssets(onProgress?: (done: number, total: number) => void): Promise<DeviceAsset[]> {
  const all: DeviceAsset[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page: Awaited<ReturnType<PhotoLibraryPlugin["list"]>> = await PhotoLibrary.list({ offset, limit: 1000 });
    all.push(...page.assets);
    onProgress?.(all.length, page.total);
    offset = page.nextOffset;
  }
  return all;
}

export function base64ToBlob(data: string, type = "image/jpeg"): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
