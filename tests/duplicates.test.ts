import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { differenceHash, duplicateTotals, findDuplicates, hashDistance, isOldFingerprint, makeFingerprint, markNotDuplicate, setHashes } from "../src/core/duplicates";
import { removePhotos } from "../src/core/library";
import type { Photo } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function photo(id: string, hash: string | undefined, extra: Partial<Photo> = {}): Photo {
  return { id, fileName: `${id}.jpg`, mimeType: "image/jpeg", bytes: 1000, width: 400, height: 300, takenAt: 0, importedAt: 0, status: "sorted", hash, source: { kind: "file" }, ...extra };
}

// A 16x16 grayscale picture with detail everywhere, and a re-saved copy of it (slightly
// brighter, a little compression noise).
const scene = Array.from({ length: 256 }, (_, i) => 40 + ((i * 97) % 180));
const resaved = scene.map((v, i) => v * 1.05 + 6 + ((i * 31) % 5) - 2);
// The same wall with the person in another pose: one patch of the picture is different.
const posed = scene.map((v, i) => ((i >> 4) >= 4 && (i >> 4) < 9 && (i & 15) >= 7 && (i & 15) < 10 ? 255 - v : v));

const A_HASH = "3c7e1f0f8f1e3c78";
const A = makeFingerprint(A_HASH, scene);
// A copy of A whose hash is one bit off, and an unrelated picture.
const A2 = makeFingerprint("3c7e1f0f8f1e3c79", resaved);
const B = makeFingerprint("a5b4c3d2e1f00918", scene.map((v) => 255 - v));

describe("duplicate photos", () => {
  it("fingerprints a 9x8 image by comparing each pixel with its right-hand neighbour", () => {
    const falling = Array.from({ length: 72 }, (_, i) => 100 - (i % 9));
    expect(differenceHash(falling)).toBe("ffffffffffffffff");
    expect(hashDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hashDistance(A, A2)).toBe(1);
    expect(isOldFingerprint(A_HASH)).toBe(true);
    expect(isOldFingerprint(A)).toBe(false);
  });

  it("groups look-alike photos and keeps the biggest copy", () => {
    const groups = findDuplicates([
      photo("small", A, { width: 200, height: 150 }),
      photo("big", A2, { bytes: 3000 }),
      photo("other", B),
      photo("unchecked", undefined),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].photos.map((p) => p.id)).toEqual(["big", "small"]);
    expect(groups[0].extraBytes).toBe(1000);
    expect(duplicateTotals(groups)).toEqual({ extras: 1, bytes: 1000 });
  });

  it("keeps the original when copies are the same size", () => {
    const groups = findDuplicates([photo("copy", A, { takenAt: 50 }), photo("original", A, { takenAt: 10 }), photo("copy2", A, { takenAt: 90 })]);
    expect(groups[0].photos.map((p) => p.id)).toEqual(["original", "copy", "copy2"]);
    expect(duplicateTotals(groups).extras).toBe(2);
  });

  it("does not match photos that are only somewhat alike, a different shape, or plain", () => {
    const fourBitsOff = makeFingerprint("3c7e1f0f8f1e3c77", scene);
    expect(hashDistance(A, fourBitsOff)).toBe(4);
    expect(findDuplicates([photo("a", A), photo("b", fourBitsOff)])).toEqual([]);
    expect(findDuplicates([photo("a", A), photo("b", A, { width: 300, height: 400 })])).toEqual([]);
    const plain = makeFingerprint("0000000000000000", scene);
    expect(findDuplicates([photo("a", plain), photo("b", plain)])).toEqual([]);
    expect(findDuplicates([photo("a", ""), photo("b", "")])).toEqual([]);
  });

  it("never matches different shots of the same scene, like a new pose in front of the same wall", () => {
    // Same hash (the coarse picture barely changes), but part of the picture is different.
    expect(findDuplicates([photo("a", A), photo("b", makeFingerprint(A_HASH, posed))])).toEqual([]);
    // A small move, like an arm or a turned head, is enough.
    const nudged = scene.map((v, i) => (i === 120 ? v + 90 : v));
    expect(findDuplicates([photo("a", A), photo("b", makeFingerprint(A_HASH, nudged))])).toEqual([]);
  });

  it("ignores fingerprints from before the detail check until they are worked out again", () => {
    expect(findDuplicates([photo("a", A_HASH), photo("b", A_HASH)])).toEqual([]);
  });

  it("stops flagging a set the person says isn't duplicates, until a new copy arrives", () => {
    const state = { photos: [photo("a", A), photo("b", A2)], categories: seedCategories(newId) };
    const kept = markNotDuplicate(state, ["a", "b"]);
    expect(kept.putPhotos.map((p) => p.id)).toEqual(["a", "b"]);
    expect(findDuplicates(kept.state.photos)).toEqual([]);
    expect(findDuplicates([...kept.state.photos, photo("c", A)])).toHaveLength(1);
  });

  it("is not a category: deleting a copy leaves the other where it was", () => {
    let state = { photos: [photo("a", undefined, { categoryId: "x" }), photo("b", undefined, { categoryId: "x" })], categories: seedCategories(newId) };
    state = setHashes(state, new Map([["a", A], ["b", A], ["gone", B]])).state;
    expect(findDuplicates(state.photos)).toHaveLength(1);
    state = removePhotos(state, ["b"]).state;
    expect(findDuplicates(state.photos)).toEqual([]);
    expect(state.photos[0].categoryId).toBe("x");
  });
});
