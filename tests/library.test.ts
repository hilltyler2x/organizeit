import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { applyClassification, movePhotos, removePhotos, renameCategory, type LibraryState } from "../src/core/library";
import { formatBytes, usageByCategory } from "../src/core/storage";
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
    expect(() => applyClassification(s, "a", { section: "products", category: "Other", label: "?", confidence: 0.2 }, newId)).toThrow();
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
