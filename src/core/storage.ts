import type { Category, Photo, Section } from "./types";

export interface CategoryUsage {
  category: Category;
  count: number;
  bytes: number;
}

export function usageByCategory(categories: Category[], photos: Photo[]): CategoryUsage[] {
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const p of photos) {
    if (p.status !== "sorted" || !p.categoryId) continue;
    const t = totals.get(p.categoryId) ?? { count: 0, bytes: 0 };
    t.count += 1;
    t.bytes += p.bytes;
    totals.set(p.categoryId, t);
  }
  return categories
    .map((category) => ({ category, ...(totals.get(category.id) ?? { count: 0, bytes: 0 }) }))
    .sort((a, b) => b.bytes - a.bytes || a.category.name.localeCompare(b.category.name));
}

export function usageBySection(usage: CategoryUsage[]): Record<Section, { count: number; bytes: number }> {
  const out: Record<Section, { count: number; bytes: number }> = {
    business: { count: 0, bytes: 0 },
    products: { count: 0, bytes: 0 },
    personal: { count: 0, bytes: 0 },
  };
  for (const u of usage) {
    out[u.category.section].count += u.count;
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

/** Where deleted photos went, for the note shown after a delete. */
export type DeleteTarget = "ios" | "android" | "organizeit";

/** The note shown after deleting photos: how many, how much space, and where they went. */
export function deletedNotice(count: number, bytes: number, target: DeleteTarget): string {
  const what = `${count} photo${count === 1 ? "" : "s"} (${formatBytes(bytes)})`;
  if (target === "ios") return `Deleted ${what} from your iPhone. They stay in Recently Deleted in Photos for 30 days; empty it there to get the space back now.`;
  if (target === "android") return `Deleted ${what} from your phone.`;
  return `Removed ${what} from OrganizeIt.`;
}

/** Categories the AI created that no longer hold any photos; these get cleaned up. */
export function emptyCreatedCategories(categories: Category[], photos: Photo[]): Category[] {
  const used = new Set(photos.filter((p) => p.categoryId).map((p) => p.categoryId));
  return categories.filter((c) => !c.seeded && !used.has(c.id));
}
