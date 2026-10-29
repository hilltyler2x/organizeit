import type { Change, LibraryState } from "./library";
import type { Photo } from "./types";

// Duplicate photos: the same picture saved twice, a re-downloaded copy, or a resized or
// re-compressed copy. Never two different shots, even ones taken seconds apart in front of the
// same wall: a different pose is a different photo.
//
// Each photo gets a fingerprint in two parts, `<hash>.<detail>`:
// - hash: a 64-bit "difference hash" of a 9x8 grayscale copy (16 hex digits). Cheap to compare,
//   used to find candidates. On its own it is too coarse: a person moving an arm barely changes it.
// - detail: a 16x16 grayscale copy (256 bytes, base64). Two candidates only count as copies when
//   every part of the picture matches, so a moved arm, a step to the side or a turned head
//   rules them out.
// Duplicates are a to-do list like To review, never a category: every photo keeps its own
// category, and the person decides which copies to delete.

/** Hashes differing in at most this many of 64 bits are compared in detail. */
export const MAX_DISTANCE = 3;
/** Detail of copies differs by at most this much in any 4x4 area (in standard deviations). */
export const MAX_AREA_DIFFERENCE = 0.08;
/** ...and by at most this much in any single cell. Copies measure around 0.1, a moved arm 1 or more. */
export const MAX_CELL_DIFFERENCE = 0.3;
/** Photos taken further apart than this are different moments (1 second, for clock rounding). */
export const SAME_MOMENT_MS = 1000;

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

/** A fingerprint from its two parts: the 9x8 difference hash and the 16x16 grayscale detail. */
export function makeFingerprint(hash: string, detail: ArrayLike<number>): string {
  if (detail.length !== 256) throw new Error("A fingerprint needs a 16x16 detail image.");
  let binary = "";
  for (let i = 0; i < 256; i++) binary += String.fromCharCode(Math.max(0, Math.min(255, Math.round(detail[i]))));
  return `${hash}.${btoa(binary)}`;
}

/** Fingerprints made before the detail part was added; these are worked out again. */
export function isOldFingerprint(fingerprint: string): boolean {
  return fingerprint !== "" && !fingerprint.includes(".");
}

/** The detail part, scaled so overall brightness and contrast don't matter (a re-save can shift both). */
function detailOf(fingerprint: string): Float64Array | null {
  const dot = fingerprint.indexOf(".");
  if (dot < 0) return null;
  const binary = atob(fingerprint.slice(dot + 1));
  if (binary.length !== 256) return null;
  const v = new Float64Array(256);
  let mean = 0;
  for (let i = 0; i < 256; i++) mean += v[i] = binary.charCodeAt(i);
  mean /= 256;
  let variance = 0;
  for (let i = 0; i < 256; i++) variance += (v[i] - mean) ** 2;
  const sd = Math.sqrt(variance / 256) || 1;
  for (let i = 0; i < 256; i++) v[i] = (v[i] - mean) / sd;
  return v;
}

/** True when every part of two detail images matches, as it does for copies of one shot. */
export function sameDetail(a: Float64Array, b: Float64Array): boolean {
  const areas = new Float64Array(16);
  for (let i = 0; i < 256; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > MAX_CELL_DIFFERENCE) return false;
    areas[(i >> 6) * 4 + ((i & 15) >> 2)] += d / 16;
  }
  return areas.every((d) => d <= MAX_AREA_DIFFERENCE);
}

/** How many of the 64 bits two fingerprints' hashes differ in. */
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

/**
 * Two photos the same size taken at different moments are separate shots, however alike they
 * look: a burst, or the same pose tried twice in front of the same wall. A copy of one photo
 * either keeps its moment (Duplicate in Photos, an edit saved as a copy), is the very same file
 * saved twice, or was resized or re-compressed on the way (shared, downloaded, screenshotted).
 */
export function differentMoments(a: Photo, b: Photo): boolean {
  if (sameMoment(a, b)) return false;
  // Two screenshots taken at different times are two different screens: an invoice and the
  // next month's invoice look alike but say different things.
  if (a.isScreenshot && b.isScreenshot) return true;
  return a.width === b.width && a.height === b.height && a.bytes !== b.bytes;
}

function sameMoment(a: Photo, b: Photo): boolean {
  return Math.abs(a.takenAt - b.takenAt) <= SAME_MOMENT_MS;
}

/** The very same file twice: same size in pixels and in bytes. */
function sameFile(a: Photo, b: Photo): boolean {
  return a.width === b.width && a.height === b.height && a.bytes === b.bytes;
}

/**
 * Whether a look-alike pair needs a close look before it counts as copies. A pair from the same
 * moment, or the very same file, doesn't. Anything else (say a resized copy) might be a different
 * picture that only looks the same small, like a receipt with another order number, so the app
 * compares the two at full detail first (`setPairVerdicts`).
 */
export function needsCloseLook(a: Photo, b: Photo): boolean {
  return !sameMoment(a, b) && !sameFile(a, b);
}

function pairKey(a: Photo, b: Photo): [Photo, string] {
  return a.id < b.id ? [a, b.id] : [b, a.id];
}

/** What the close look found for a pair: true for copies, false for different pictures, undefined if not looked at yet. */
export function pairVerdict(a: Photo, b: Photo): boolean | undefined {
  const [owner, other] = pairKey(a, b);
  return owner.closeLooks?.[other];
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

/** Pairs of photos that look alike in their fingerprints, as index pairs into `hashed`. */
function lookAlikes(photos: Photo[]): { hashed: Photo[]; pairs: [number, number][] } {
  const hashed = photos.filter((p) => p.hash && !isOldFingerprint(p.hash) && !tooPlain(p.hash));
  const details = new Map<number, Float64Array | null>();
  const detail = (i: number) => {
    if (!details.has(i)) details.set(i, detailOf(hashed[i].hash!));
    return details.get(i)!;
  };
  const alike = (a: number, b: number) => {
    if (hashDistance(hashed[a].hash!, hashed[b].hash!) > MAX_DISTANCE || !sameShape(hashed[a], hashed[b])) return false;
    if (differentMoments(hashed[a], hashed[b])) return false;
    const da = detail(a);
    const db = detail(b);
    return !!da && !!db && sameDetail(da, db);
  };
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
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const a = Math.min(list[x], list[y]);
        const b = Math.max(list[x], list[y]);
        const key = `${a}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (alike(a, b)) pairs.push([a, b]);
      }
    }
  }
  return { hashed, pairs };
}

/** Look-alike pairs still waiting for a close look, newest first. */
export function pairsToLookAt(photos: Photo[]): [Photo, Photo][] {
  const { hashed, pairs } = lookAlikes(photos);
  return pairs
    .map(([a, b]): [Photo, Photo] => [hashed[a], hashed[b]])
    .filter(([a, b]) => needsCloseLook(a, b) && pairVerdict(a, b) === undefined)
    .sort((x, y) => Math.max(y[0].takenAt, y[1].takenAt) - Math.max(x[0].takenAt, x[1].takenAt));
}

/**
 * Groups photos that are copies of each other. A group the person marked "not duplicates" is
 * left out until a new copy joins it. Largest space to free first.
 */
export function findDuplicates(photos: Photo[]): DuplicateGroup[] {
  const { hashed, pairs } = lookAlikes(photos);
  const parent = hashed.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  // Members of each set, so two sets are never joined through a resized copy when they hold
  // shots from different moments.
  const members = new Map<number, number[]>(hashed.map((_, i) => [i, [i]]));
  const join = (a: number, b: number) => {
    const ra = root(a);
    const rb = root(b);
    const ma = members.get(ra)!;
    const mb = members.get(rb)!;
    if (ma.some((x) => mb.some((y) => differentMoments(hashed[x], hashed[y])))) return;
    parent[ra] = rb;
    members.set(rb, [...mb, ...ma]);
    members.delete(ra);
  };
  for (const [a, b] of pairs) {
    if (root(a) === root(b)) continue;
    // Only pairs that passed a close look (or need none) are copies.
    if (needsCloseLook(hashed[a], hashed[b]) && pairVerdict(hashed[a], hashed[b]) !== true) continue;
    join(a, b);
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

/** Saves what close looks found, as [photo, photo, copies?]. */
export function setPairVerdicts(state: LibraryState, verdicts: [Photo, Photo, boolean][]): Change {
  const updates = new Map<string, Record<string, boolean>>();
  for (const [a, b, same] of verdicts) {
    const [owner, other] = pairKey(a, b);
    const current = updates.get(owner.id) ?? { ...state.photos.find((p) => p.id === owner.id)?.closeLooks };
    current[other] = same;
    updates.set(owner.id, current);
  }
  const changed: Photo[] = [];
  const photos = state.photos.map((p) => {
    const closeLooks = updates.get(p.id);
    if (!closeLooks) return p;
    const next = { ...p, closeLooks };
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
