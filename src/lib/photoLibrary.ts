import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DeviceAsset } from "../core/library";

// Bridge to the native photo library plugin in native/photo-library (iOS PhotoKit,
// Android MediaStore). Only available inside the iOS/Android app.

export type PermissionStatus = "granted" | "limited" | "denied" | "prompt";

interface PhotoLibraryPlugin {
  checkPermission(): Promise<{ status: PermissionStatus }>;
  requestPermission(): Promise<{ status: PermissionStatus }>;
  openSettings(): Promise<void>;
  list(options: { offset: number; limit: number }): Promise<{ assets: DeviceAsset[]; total: number; nextOffset: number | null }>;
  getImage(options: { id: string; maxSide: number; quality?: number }): Promise<{ data: string; width: number; height: number }>;
  deleteAssets(options: { ids: string[] }): Promise<{ deleted: boolean }>;
}

export const PhotoLibrary = registerPlugin<PhotoLibraryPlugin>("PhotoLibrary");

export const isNativeApp = Capacitor.isNativePlatform();

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
