import { describe, expect, it } from "vitest";
import { applyBackgroundResults, backgroundQueue } from "../src/core/background";
import { seedCategories } from "../src/core/categories";
import type { DeviceAsset, LibraryState } from "../src/core/library";
import type { Photo, PhotoStatus } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function phonePhoto(assetId: string, takenAt: number, status: PhotoStatus = "queued"): Photo {
  return { id: `p-${assetId}`, fileName: `${assetId}.jpg`, mimeType: "image/jpeg", bytes: 1000, width: 10, height: 10, takenAt, importedAt: 0, status, source: { kind: "native", assetId } };
}

function asset(id: string): DeviceAsset {
  return { id, fileName: `${id}.jpg`, width: 10, height: 10, createdAt: 0, bytes: 1000, mimeType: "image/jpeg", isScreenshot: false };
}

function start(...photos: Photo[]): LibraryState {
  return { photos, categories: seedCategories(newId) };
}

describe("background sorting", () => {
  it("hands over waiting phone photos newest first, and the newest photo it knows", () => {
    const file: Photo = { ...phonePhoto("f", 999), source: { kind: "file" } };
    const s = start(phonePhoto("old", 1), phonePhoto("new", 3, "classifying"), phonePhoto("done", 5, "sorted"), file);
    expect(backgroundQueue(s)).toEqual({ queued: ["new", "old"], knownUpTo: 5 });
  });

  it("files photos sorted while the app was closed, creating categories as needed", () => {
    const s = start(phonePhoto("a", 1), phonePhoto("b", 2));
    const c = applyBackgroundResults(s, [
      { asset: asset("a"), result: { section: "products", category: "Sneakers", label: "Jordan 1", confidence: 0.9 } },
      { asset: asset("b"), result: { section: "products", category: "Sneakers", label: "Dunk Low", confidence: 0.9 } },
    ], newId);
    const sneakers = c.state.categories.filter((x) => x.name === "Sneakers");
    expect(sneakers).toHaveLength(1);
    expect(c.state.photos.every((p) => p.status === "sorted" && p.categoryId === sneakers[0].id)).toBe(true);
    expect(c.putPhotos).toHaveLength(2);
    expect(c.putCategories.map((x) => x.name)).toEqual(["Sneakers"]);
  });

  it("sends unsure answers to review instead of a category", () => {
    const c = applyBackgroundResults(start(phonePhoto("a", 1)), [
      { asset: asset("a"), result: { section: "products", category: "Bags", label: "blurry bag", confidence: 0.3 } },
    ], newId);
    expect(c.state.photos[0].status).toBe("review");
    expect(c.state.photos[0].suggestion).toEqual({ section: "products", category: "Bags" });
  });

  it("leaves photos alone that are being sorted, already filed, or unknown", () => {
    const s = start(phonePhoto("busy", 1, "classifying"), phonePhoto("filed", 2, "sorted"));
    const result = { section: "products" as const, category: "Hats", label: "cap", confidence: 0.9 };
    const c = applyBackgroundResults(s, [
      { asset: asset("busy"), result },
      { asset: asset("filed"), result },
      { asset: asset("gone"), result },
    ], newId);
    expect(c.state).toBe(s);
    expect(c.putPhotos).toEqual([]);
  });
});
