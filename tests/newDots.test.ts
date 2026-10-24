import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { applyClassification, categoriesWithNew, markCategorySeen, movePhotos, type LibraryState } from "../src/core/library";
import type { Photo } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function photo(id: string): Photo {
  return { id, fileName: `${id}.jpg`, mimeType: "image/jpeg", bytes: 1000, width: 10, height: 10, takenAt: 0, importedAt: 0, status: "queued", source: { kind: "file" } };
}

const hat = { section: "products" as const, category: "Hats", label: "cap", confidence: 0.9 };
const hatsId = (s: LibraryState) => s.categories.find((c) => c.name === "Hats")!.id;

describe("new dots", () => {
  it("shows a dot when the AI files a photo, clears it when opened, and brings it back for the next one", () => {
    let s: LibraryState = { photos: [photo("a"), photo("b")], categories: seedCategories(newId) };
    s = applyClassification(s, "a", hat, newId, 100).state;
    expect(categoriesWithNew(s).has(hatsId(s))).toBe(true);

    const seen = markCategorySeen(s, hatsId(s), 200);
    expect(seen.putCategories.map((c) => c.seenAt)).toEqual([200]);
    s = seen.state;
    expect(categoriesWithNew(s).size).toBe(0);

    s = applyClassification(s, "b", hat, newId, 300).state;
    expect(categoriesWithNew(s).has(hatsId(s))).toBe(true);
  });

  it("does not count photos the person filed themselves", () => {
    let s: LibraryState = { photos: [photo("a")], categories: seedCategories(newId) };
    s = applyClassification(s, "a", hat, newId, 100).state;
    const belts = s.categories.find((c) => c.name === "Belts")!.id;
    s = movePhotos(s, ["a"], { categoryId: belts }, newId).state;
    expect(categoriesWithNew(s).size).toBe(0);
  });
});
