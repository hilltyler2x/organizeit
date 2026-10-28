import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { applyClassification, applyClassifications, movePhotos, removePhotos, renameCategory, type LibraryState } from "../src/core/library";
import { deletedNotice, formatBytes, usageByCategory } from "../src/core/storage";
import type { Photo } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function photo(id: string, bytes = 1000): Photo {
  return { id, fileName: `${id}.jpg`, mimeType: "image/jpeg", bytes, width: 10, height: 10, takenAt: 0, importedAt: 0, status: "queued", source: { kind: "file" } };
}

function start(...photos: Photo[]): LibraryState {
  return { photos, categories: seedCategories(newId) };
}

describe("library", () => {
  it("files a photo into an existing category", () => {
    const s = start(photo("a"));
    const c = applyClassification(s, "a", { section: "products", category: "Wallet", label: "leather wallet", confidence: 0.9 }, newId);
    const p = c.state.photos[0];
    expect(p.status).toBe("sorted");
    expect(c.state.categories.find((x) => x.id === p.categoryId)?.name).toBe("Wallets");
    expect(c.putCategories).toEqual([]);
  });

  it("creates a new category for something new", () => {
    const s = start(photo("a"));
    const c = applyClassification(s, "a", { section: "products", category: "Sneakers", label: "Jordan 1", confidence: 0.95 }, newId);
    expect(c.putCategories.map((x) => x.name)).toEqual(["Sneakers"]);
    expect(c.state.categories.some((x) => x.name === "Sneakers")).toBe(true);
  });

  it("never files into a catch-all", () => {
    const s = start(photo("a"));
    expect(() => applyClassification(s, "a", { section: "products", category: "Other", label: "?", confidence: 0.9 }, newId)).toThrow();
    expect(() => movePhotos(s, ["a"], { section: "products", name: "Misc" }, newId)).toThrow();
  });

  it("removes AI-created categories once they are empty, but keeps seeded ones", () => {
    let s = start(photo("a"), photo("b"));
    s = applyClassification(s, "a", { section: "products", category: "Sneakers", label: "", confidence: 1 }, newId).state;
    s = applyClassification(s, "b", { section: "products", category: "Socks", label: "", confidence: 1 }, newId).state;
    const sneakers = s.categories.find((c) => c.name === "Sneakers")!;
    const socks = s.categories.find((c) => c.name === "Socks")!;
    const moved = movePhotos(s, ["a"], { categoryId: socks.id }, newId);
    expect(moved.state.categories.some((c) => c.id === sneakers.id)).toBe(false);
    expect(moved.deletedCategoryIds).toEqual([sneakers.id]);
    const removed = removePhotos(moved.state, ["a", "b"]);
    expect(removed.state.categories.some((c) => c.id === socks.id)).toBe(true);
  });

  it("moving to a typed name reuses a matching category", () => {
    const s = start(photo("a"));
    const c = movePhotos(s, ["a"], { section: "products", name: "beanie" }, newId);
    expect(c.state.categories.find((x) => x.id === c.state.photos[0].categoryId)?.name).toBe("Beanies");
    expect(c.putCategories).toEqual([]);
  });

  it("renaming into an existing name merges the categories", () => {
    let s = start(photo("a"));
    s = applyClassification(s, "a", { section: "products", category: "Caps", label: "", confidence: 1 }, newId).state;
    // "Caps" is a synonym of Hats, so it was filed there; create a distinct one to merge.
    s = movePhotos(s, ["a"], { section: "products", name: "Trucker Lids" }, newId).state;
    const lids = s.categories.find((c) => c.name === "Trucker Lids")!;
    const merged = renameCategory(s, lids.id, "hats", newId);
    expect(merged.state.categories.find((c) => c.id === merged.state.photos[0].categoryId)?.name).toBe("Hats");
    expect(merged.state.categories.some((c) => c.id === lids.id)).toBe(false);
    expect(() => renameCategory(merged.state, merged.state.photos[0].categoryId!, "Other", newId)).toThrow();
  });

  it("totals storage per category, largest first", () => {
    let s = start(photo("a", 5_000_000), photo("b", 2_000_000), photo("c", 4_000_000));
    s = applyClassification(s, "a", { section: "business", category: "Receipts", label: "", confidence: 1 }, newId).state;
    s = applyClassification(s, "b", { section: "products", category: "Bags", label: "", confidence: 1 }, newId).state;
    s = applyClassification(s, "c", { section: "products", category: "Bags", label: "", confidence: 1 }, newId).state;
    const usage = usageByCategory(s.categories, s.photos).filter((u) => u.count);
    expect(usage.map((u) => [u.category.name, u.count, u.bytes])).toEqual([["Bags", 2, 6_000_000], ["Receipts", 1, 5_000_000]]);
    expect(formatBytes(6_000_000)).toBe("5.7 MB");
  });
});

describe("applyClassifications", () => {
  it("files a whole batch in one change", () => {
    const s = start(photo("a"), photo("b"), photo("c"), photo("d"));
    const c = applyClassifications(
      s,
      [
        { photoId: "a", result: { section: "products", category: "Sneakers", label: "Jordan 1", confidence: 0.95 } },
        { photoId: "b", result: { section: "products", category: "Sneakers", label: "Dunk Low", confidence: 0.9 } },
        { photoId: "c", result: { section: "products", category: "Bags", label: "tote", confidence: 0.2 } },
      ],
      newId,
    );
    const [a, b, cc, d] = c.state.photos;
    expect(a.status).toBe("sorted");
    expect(b.categoryId).toBe(a.categoryId);
    expect(cc.status).toBe("review");
    expect(d.status).toBe("queued");
    expect(c.putPhotos.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(c.putCategories.map((x) => x.name)).toEqual(["Sneakers"]);
    expect(c.deletedCategoryIds).toEqual([]);
  });

  it("never files a catch-all, and still files the rest", () => {
    const s = start(photo("a"), photo("b"));
    const c = applyClassifications(
      s,
      [
        { photoId: "a", result: { section: "products", category: "Other", label: "?", confidence: 0.9 } },
        { photoId: "b", result: { section: "products", category: "Bags", label: "tote", confidence: 0.9 } },
      ],
      newId,
    );
    expect(c.state.photos[0].status).toBe("error");
    expect(c.state.photos[1].status).toBe("sorted");
    expect(c.state.categories.some((x) => /other/i.test(x.name))).toBe(false);
  });
});

describe("syncWithDevice", () => {
  const asset = (id: string, extra: Partial<import("../src/core/library").DeviceAsset> = {}) => ({
    id, fileName: `${id}.heic`, width: 10, height: 10, createdAt: 1, bytes: 100, mimeType: "image/heic", isScreenshot: false, ...extra,
  });

  it("queues new photos, keeps known ones and drops ones deleted on the phone", async () => {
    const { syncWithDevice } = await import("../src/core/library");
    let s = start();
    let c = syncWithDevice(s, [asset("A"), asset("B", { isScreenshot: true })], newId);
    expect(c.state.photos.map((p) => [p.source, p.status, p.isScreenshot])).toEqual([
      [{ kind: "native", assetId: "A" }, "queued", false],
      [{ kind: "native", assetId: "B" }, "queued", true],
    ]);
    s = c.state;
    const b = s.photos.find((p) => p.source.kind === "native" && p.source.assetId === "B")!;
    s = applyClassification(s, b.id, { section: "products", category: "Sneakers", label: "", confidence: 1 }, newId).state;
    c = syncWithDevice(s, [asset("A"), asset("C")], newId);
    expect(c.putPhotos.map((p) => p.source)).toEqual([{ kind: "native", assetId: "C" }]);
    expect(c.deletedPhotoIds).toEqual([b.id]);
    expect(c.state.categories.some((x) => x.name === "Sneakers")).toBe(false);
    expect(c.state.photos).toHaveLength(2);
  });

  it("leaves photos added from files alone", async () => {
    const { syncWithDevice } = await import("../src/core/library");
    const s = start(photo("f"));
    expect(syncWithDevice(s, [], newId).state.photos.map((p) => p.id)).toEqual(["f"]);
  });
});

describe("deletedNotice", () => {
  it("says where deleted photos went and how much space", () => {
    expect(deletedNotice(1, 2048, "ios")).toBe(
      "Deleted 1 photo (2.0 KB) from your iPhone. They stay in Recently Deleted in Photos for 30 days; empty it there to get the space back now.",
    );
    expect(deletedNotice(3, 3 * 1024 * 1024, "android")).toBe("Deleted 3 photos (3.0 MB) from your phone.");
    expect(deletedNotice(2, 500, "organizeit")).toBe("Removed 2 photos (500 B) from OrganizeIt.");
  });
});
