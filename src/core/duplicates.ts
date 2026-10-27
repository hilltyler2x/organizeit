import type { Change, LibraryState } from "./library";
import type { Photo } from "./types";

// Duplicate photos: the same picture saved twice, a re-downloaded copy, or the same screen
// screenshotted again. Each photo gets a tiny fingerprint of what it looks like (a 64-bit
// "difference hash" of a 9x8 grayscale copy, as 16 hex digits), and photos whose fingerprints
// nearly match are grouped. Duplicates are a to-do list like To review, never a category:
// every photo keeps its own category, and the person decides which copies to delete.

/** Fingerprints differing in at most this many of 64 bits count as the same picture. */
export const MAX_DISTANCE = 3;

export interface DuplicateGroup {
  /** The copies, the one OrganizeIt suggests keeping first. */
  photos: Photo[];
  /** Space freed by deleting every copy but the first. */
  extraBytes: number;
}

/**
 * Fingerprint of a grayscale image `pixels` laid out as 8 rows of 9 brightness values: each
 * bit says whether a pixel is brighter than its right-hand neighbour.
 */
export function differenceHash(pixels: ArrayLike<number>): string {
  if (pixels.length !== 72) throw new Error("A fingerprint needs a 9x8 image.");
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col;
      byte = (byte << 1) | (pixels[i] > pixels[i + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function bitCount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** How many of the 64 bits two fingerprints differ in. */
export function hashDistance(a: string, b: string): number {
  return (
    bitCount(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) +
    bitCount(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16))
  );
}

/**
 * Plain images (a black pocket shot, a white page, a smooth sky) have nearly all-0 or all-1
 * fingerprints and would match each other without being the same picture, so they are left out.
 */
function tooPlain(hash: string): boolean {
  const ones = bitCount(parseInt(hash.slice(0, 8), 16)) + bitCount(parseInt(hash.slice(8), 16));
  return ones <= 2 || ones >= 62;
}

function sameShape(a: Photo, b: Photo): boolean {
  // A video's fingerprint is its opening frame, so a video is only a copy of another video of
  // the same length, never of a photo.
  if (Boolean(a.isVideo) !== Boolean(b.isVideo)) return false;
  if (a.isVideo && Math.abs((a.durationMs ?? 0) - (b.durationMs ?? 0)) > 1000) return false;
  if (!a.width || !a.height || !b.width || !b.height) return true;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) / Math.max(ra, rb) < 0.03;
}

/** Which copy to keep: the biggest picture, then the bigger file, then the oldest (the original). */
function keepOrder(a: Photo, b: Photo): number {
  return b.width * b.height - a.width * a.height || b.bytes - a.bytes || a.takenAt - b.takenAt || a.id.localeCompare(b.id);
}

/**
 * Groups photos that look the same. A group the person marked "not duplicates" is left out
 * until a new copy joins it. Largest space to free first.
 */
export function findDuplicates(photos: Photo[]): DuplicateGroup[] {
  const hashed = photos.filter((p) => p.hash && !tooPlain(p.hash));
  // Two fingerprints within 3 bits share at least one of their four 16-bit quarters exactly,
  // so only photos sharing a quarter need comparing.
  const buckets = new Map<string, number[]>();
  hashed.forEach((p, i) => {
    for (let q = 0; q < 4; q++) {
      const key = `${q}:${p.hash!.slice(q * 4, q * 4 + 4)}`;
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
  });
  const parent = hashed.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = list[x];
        const b = list[y];
        if (root(a) === root(b)) continue;
        if (hashDistance(hashed[a].hash!, hashed[b].hash!) <= MAX_DISTANCE && sameShape(hashed[a], hashed[b])) parent[root(a)] = root(b);
      }
    }
  }
  const groups = new Map<number, Photo[]>();
  hashed.forEach((p, i) => {
    const r = root(i);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1 && g.some((p) => !p.notDuplicate))
    .map((g) => {
      const sorted = [...g].sort(keepOrder);
      return { photos: sorted, extraBytes: sorted.slice(1).reduce((n, p) => n + p.bytes, 0) };
    })
    .sort((a, b) => b.extraBytes - a.extraBytes || b.photos.length - a.photos.length);
}

/** Copies that could go, and the space they use, across all groups. */
export function duplicateTotals(groups: DuplicateGroup[]): { extras: number; bytes: number } {
  return groups.reduce((t, g) => ({ extras: t.extras + g.photos.length - 1, bytes: t.bytes + g.extraBytes }), { extras: 0, bytes: 0 });
}

/** The person says these photos are not copies of each other: stop flagging them. */
export function markNotDuplicate(state: LibraryState, photoIds: string[]): Change {
  const ids = new Set(photoIds);
  const changed: Photo[] = [];
  const photos = state.photos.map((p) => {
    if (!ids.has(p.id) || p.notDuplicate) return p;
    const next = { ...p, notDuplicate: true };
    changed.push(next);
    return next;
  });
  return { state: { ...state, photos }, putPhotos: changed, putCategories: [], deletedCategoryIds: [], deletedPhotoIds: [] };
}

/** Saves fingerprints worked out for photos, by photo id. An empty string means it couldn't be read. */
export function setHashes(state: LibraryState, hashes: Map<string, string>): Change {
  const changed: Photo[] = [];
  const photos = state.photos.map((p) => {
    const hash = hashes.get(p.id);
    if (hash === undefined || p.hash === hash) return p;
    const next = { ...p, hash };
    changed.push(next);
    return next;
  });
  return { state: { ...state, photos }, putPhotos: changed, putCategories: [], deletedCategoryIds: [], deletedPhotoIds: [] };
}
