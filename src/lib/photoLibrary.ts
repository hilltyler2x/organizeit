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
   * A JPEG of a photo, or of a video's opening frame. With `frames`, a video comes back as six
   * frames from across the clip in a grid instead, for sorting.
   */
  getImage(options: { id: string; maxSide: number; quality?: number; frames?: boolean }): Promise<{ data: string; width: number; height: number }>;
  /** Where a video can be played from: a file path (iOS) or content URI (Android). */
  getVideo(options: { id: string }): Promise<{ path: string }>;
  deleteAssets(options: { ids: string[] }): Promise<{ deleted: boolean }>;
  /** Fires the moment photos are added to or removed from the library while the app runs. */
  addListener(event: "libraryChanged", listener: (info: { added?: number }) => void): Promise<PluginListenerHandle>;
  /**
   * Adds photos to an album, creating it if needed. iOS: a Photos album pointing at the
   * originals. Android: copies in Pictures/OrganizeIt/<title> (Android 10+).
   */
  addToAlbum(options: { ids: string[]; title: string }): Promise<{ added: number; title: string; created: boolean }>;
  /** Copies a photo to the clipboard so it can be pasted into other apps. */
  copyImage(options: { id: string }): Promise<void>;
  /** Opens the phone's share sheet for a photo. */
  shareImage(options: { id: string }): Promise<{ completed: boolean }>;
  /** An id for this phone that survives deleting and reinstalling the app. Empty if unavailable. */
  deviceId(): Promise<{ id: string }>;
}

export const PhotoLibrary = registerPlugin<PhotoLibraryPlugin>("PhotoLibrary");

export const isNativeApp = Capacitor.isNativePlatform();

/** Whether photos can be put into an album (the iPhone and Android apps). */
export const canMakeAlbums = isNativeApp;

/** Android albums are folders of copies, since Android can't point an album at the originals. */
export const albumsCopyPhotos = Capacitor.getPlatform() === "android";

/** Where photos from the phone's library go when deleted. */
export const deviceDeleteTarget: DeleteTarget = Capacitor.getPlatform() === "android" ? "android" : "ios";

/** Reads the metadata of every photo on the device, in pages. */
export async function listAllAssets(onProgress?: (done: number, total: number) => void): Promise<DeviceAsset[]> {
  const all: DeviceAsset[] = [];
  let offset: number | null | undefined = 0;
  // The last page has no next offset: null, or missing altogether (Android drops null values).
  while (offset != null) {
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
