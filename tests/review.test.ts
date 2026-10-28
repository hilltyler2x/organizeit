import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { addLessons, lessonsForPrompt, lessonsFromMove, MAX_LESSONS } from "../src/core/lessons";
import { applyClassification, fileConfidentReviews, movePhotos, needsPerson, renameCategory, type LibraryState } from "../src/core/library";
import { usageByCategory } from "../src/core/storage";
import type { Lesson, Photo } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function photo(id: string): Photo {
  return { id, fileName: `${id}.jpg`, mimeType: "image/jpeg", bytes: 1000, width: 10, height: 10, takenAt: 0, importedAt: 0, status: "queued", source: { kind: "file" } };
}

function start(...photos: Photo[]): LibraryState {
  return { photos, categories: seedCategories(newId) };
}

const unsure = { section: "products" as const, category: "Sneakers", label: "black slides", confidence: 0.2 };

describe("photos the AI isn't sure about", () => {
  it("wait for the person instead of being filed, and no category is created for the guess", () => {
    const c = applyClassification(start(photo("a")), "a", unsure, newId);
    const p = c.state.photos[0];
    expect(p.status).toBe("review");
    expect(p.categoryId).toBeUndefined();
    expect(p.suggestion).toEqual({ section: "products", category: "Sneakers" });
    expect(c.putCategories).toEqual([]);
    expect(c.state.categories.some((x) => x.name === "Sneakers")).toBe(false);
    expect(needsPerson(c.state.photos).map((x) => x.id)).toEqual(["a"]);
    // The review list is not a category and counts toward no category's storage.
    expect(usageByCategory(c.state.categories, c.state.photos).every((u) => u.count === 0)).toBe(true);
  });

  it("are filed into a real category when the person picks one, several at once", () => {
    let s = start(photo("a"), photo("b"));
    s = applyClassification(s, "a", unsure, newId).state;
    s = applyClassification(s, "b", unsure, newId).state;
    const c = movePhotos(s, ["a", "b"], { section: "products", name: "Sandals" }, newId);
    const sandals = c.state.categories.find((x) => x.name === "Sandals")!;
    expect(c.state.photos.every((p) => p.status === "sorted" && p.categoryId === sandals.id && !p.suggestion)).toBe(true);
    expect(needsPerson(c.state.photos)).toEqual([]);
  });

  it("never keep a catch-all guess", () => {
    const c = applyClassification(start(photo("a")), "a", { ...unsure, category: "Other" }, newId);
    expect(c.state.photos[0].suggestion).toBeUndefined();
  });

  it("are still filed automatically when the AI is confident", () => {
    const c = applyClassification(start(photo("a")), "a", { ...unsure, confidence: 0.9 }, newId);
    expect(c.state.photos[0].status).toBe("sorted");
  });
});

describe("learning from corrections", () => {
  it("records what the person chose and what the AI got wrong", () => {
    const before = applyClassification(start(photo("a")), "a", unsure, newId).state;
    const after = movePhotos(before, ["a"], { section: "products", name: "Sandals" }, newId).state;
    const [l] = lessonsFromMove(before, after, ["a"], newId);
    expect(l).toMatchObject({ label: "black slides", category: "Sandals", wrongCategory: "Sneakers" });
  });

  it("records a confirmed guess without marking it wrong", () => {
    const before = applyClassification(start(photo("a")), "a", { ...unsure, category: "Bags" }, newId).state;
    const bags = before.categories.find((x) => x.name === "Bags")!;
    const after = movePhotos(before, ["a"], { categoryId: bags.id }, newId).state;
    const [l] = lessonsFromMove(before, after, ["a"], newId);
    expect(l.category).toBe("Bags");
    expect(l.wrongCategory).toBeUndefined();
  });

  it("learns from moving a photo the AI filed confidently, but not from staying put", () => {
    const before = applyClassification(start(photo("a")), "a", { section: "products", category: "Wallets", label: "slim card wallet", confidence: 0.9 }, newId).state;
    const holders = before.categories.find((x) => x.name === "Card Holders")!;
    const after = movePhotos(before, ["a"], { categoryId: holders.id }, newId).state;
    expect(lessonsFromMove(before, after, ["a"], newId)[0]).toMatchObject({ category: "Card Holders", wrongCategory: "Wallets" });
    const wallets = before.categories.find((x) => x.name === "Wallets")!;
    const same = movePhotos(before, ["a"], { categoryId: wallets.id }, newId).state;
    expect(lessonsFromMove(before, same, ["a"], newId)).toEqual([]);
  });

  it("keeps the newest lesson per item and caps the total", () => {
    const mk = (label: string, at: number): Lesson => ({ id: newId(), label, categoryId: "c", section: "products", category: "Bags", createdAt: at });
    const old = mk("tote", 1);
    const { lessons, dropped } = addLessons([old], [mk("Tote", 2)]);
    expect(lessons).toHaveLength(1);
    expect(dropped).toEqual([old.id]);
    const many = Array.from({ length: MAX_LESSONS + 5 }, (_, i) => mk(`item ${i}`, i));
    expect(addLessons([], many).lessons).toHaveLength(MAX_LESSONS);
  });

  it("sends lessons under the category's current name", () => {
    let s = applyClassification(start(photo("a")), "a", unsure, newId).state;
    const before = s;
    s = movePhotos(s, ["a"], { section: "products", name: "Sandals" }, newId).state;
    const lessons = lessonsFromMove(before, s, ["a"], newId);
    const sandals = s.categories.find((x) => x.name === "Sandals")!;
    s = renameCategory(s, sandals.id, "Slides", newId).state;
    expect(lessonsForPrompt(lessons, s.categories)).toEqual([{ label: "black slides", section: "products", category: "Slides", wrong: "Sneakers" }]);
    // If the category is gone, the name it had is still taught.
    expect(lessonsForPrompt(lessons, [])[0].category).toBe("Sandals");
  });
});

describe("photos left for review under the old threshold", () => {
  it("are filed under the AI's guess when it is confident enough, and the rest stay", () => {
    const waiting = (id: string, confidence: number): Photo => ({
      ...photo(id),
      status: "review",
      label: "black slides",
      confidence,
      suggestion: { section: "products", category: "Sandals" },
    });
    const c = fileConfidentReviews(start(waiting("a", 0.55), waiting("b", 0.1)), newId)!;
    const sandals = c.state.categories.find((x) => x.name === "Sandals")!;
    const [a, b] = c.state.photos;
    expect(a.status).toBe("sorted");
    expect(a.categoryId).toBe(sandals.id);
    expect(b.status).toBe("review");
    expect(needsPerson(c.state.photos).map((x) => x.id)).toEqual(["b"]);
    expect(fileConfidentReviews(c.state, newId)).toBeNull();
  });
});
