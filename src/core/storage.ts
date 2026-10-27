import type { Category, Photo, Section } from "./types";

export interface CategoryUsage {
  category: Category;
  /** Photos and videos together. */
  count: number;
  videos: number;
  bytes: number;
}

export function usageByCategory(categories: Category[], photos: Photo[]): CategoryUsage[] {
  const totals = new Map<string, { count: number; videos: number; bytes: number }>();
  for (const p of photos) {
    if (p.status !== "sorted" || !p.categoryId) continue;
    const t = totals.get(p.categoryId) ?? { count: 0, videos: 0, bytes: 0 };
    t.count += 1;
    if (p.isVideo) t.videos += 1;
    t.bytes += p.bytes;
    totals.set(p.categoryId, t);
  }
  return categories
    .map((category) => ({ category, ...(totals.get(category.id) ?? { count: 0, videos: 0, bytes: 0 }) }))
    .sort((a, b) => b.bytes - a.bytes || a.category.name.localeCompare(b.category.name));
}

export function usageBySection(usage: CategoryUsage[]): Record<Section, { count: number; videos: number; bytes: number }> {
  const out: Record<Section, { count: number; videos: number; bytes: number }> = {
    business: { count: 0, videos: 0, bytes: 0 },
    products: { count: 0, videos: 0, bytes: 0 },
    personal: { count: 0, videos: 0, bytes: 0 },
  };
  for (const u of usage) {
    out[u.category.section].count += u.count;
    out[u.category.section].videos += u.videos;
    out[u.category.section].bytes += u.bytes;
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

/** "3 photos", "1 video" or "3 photos and 1 video", for counts shown to the person. */
export function countItems(items: Pick<Photo, "isVideo">[]): string {
  const videos = items.filter((p) => p.isVideo).length;
  return countLabel(items.length - videos, videos);
}

export function countLabel(photos: number, videos: number): string {
  const p = `${photos.toLocaleString()} photo${photos === 1 ? "" : "s"}`;
  const v = `${videos.toLocaleString()} video${videos === 1 ? "" : "s"}`;
  if (!videos) return p;
  return photos ? `${p} and ${v}` : v;
}

/** A video's length as m:ss, or h:mm:ss for an hour or more. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Where deleted photos went, for the note shown after a delete. */
export type DeleteTarget = "ios" | "android" | "organizeit";

/** The note shown after deleting photos: how many, how much space, and where they went. */
export function deletedNotice(count: number, bytes: number, target: DeleteTarget, videos = 0): string {
  const what = `${countLabel(count - videos, videos)} (${formatBytes(bytes)})`;
  if (target === "ios") return `Deleted ${what} from your iPhone. They stay in Recently Deleted in Photos for 30 days; empty it there to get the space back now.`;
  if (target === "android") return `Deleted ${what} from your phone.`;
  return `Removed ${what} from OrganizeIt.`;
}

/** Categories the AI created that no longer hold any photos; these get cleaned up. */
export function emptyCreatedCategories(categories: Category[], photos: Photo[]): Category[] {
  const used = new Set(photos.filter((p) => p.categoryId).map((p) => p.categoryId));
  return categories.filter((c) => !c.seeded && !used.has(c.id));
}
