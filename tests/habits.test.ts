import { describe, expect, it } from "vitest";
import { seedCategories } from "../src/core/categories";
import { alsoMove, followHabits, labelsAlike } from "../src/core/habits";
import { lessonsForPrompt, lessonsFromMove } from "../src/core/lessons";
import { applyClassification, movePhotos, renameCategory, type LibraryState } from "../src/core/library";
import type { Classification, Lesson, Photo } from "../src/core/types";

let n = 0;
const newId = () => `id${++n}`;

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return { id, fileName: `${id}.jpg`, mimeType: "image/jpeg", bytes: 1000, width: 10, height: 10, takenAt: 0, importedAt: 0, status: "queued", source: { kind: "file" }, ...extra };
}

function start(...photos: Photo[]): LibraryState {
  return { photos, categories: seedCategories(newId) };
}

const cat = (s: LibraryState, name: string) => s.categories.find((c) => c.name === name)!;

function lesson(label: string, categoryId: string, category: string, wrongCategory?: string, createdAt = 1): Lesson {
  return { id: newId(), label, categoryId, section: "products", category, wrongCategory, createdAt };
}

const answer = (category: string, label: string, confidence = 0.9): Classification => ({ section: "products", category, label, confidence });

describe("labelsAlike", () => {
  it("matches descriptions of the same item, not of different ones", () => {
    expect(labelsAlike("Nike Dunk Low Panda sneaker", "Nike Dunk Low sneakers")).toBe(true);
    expect(labelsAlike("Hoodie", "hoodies")).toBe(true);
    expect(labelsAlike("Walmart receipt", "Target receipt")).toBe(false);
    expect(labelsAlike("black hoodie", "grey hoodie")).toBe(false);
    expect(labelsAlike("Walmart grocery receipt", "Walmart receipt")).toBe(false);
  });
});

describe("following the person's habits", () => {
  it("files a photo like one they filed by hand where they put it, even against the AI", () => {
    const s = start();
    const bags = cat(s, "Bags");
    const lessons = [lesson("Louis Vuitton Neverfull tote", bags.id, "Bags", "Wallets")];
    const r = followHabits(answer("Wallets", "Louis Vuitton Neverfull tote bag"), lessons, s);
    expect(r.category).toBe("Bags");
    expect(r.confidence).toBe(0.9);
  });

  it("uses the category's current name after a rename", () => {
    let s = start();
    const hats = cat(s, "Hats");
    s = renameCategory(s, hats.id, "Headwear Inventory", newId).state;
    const lessons = [lesson("New Era fitted cap", hats.id, "Hats")];
    expect(followHabits(answer("Beanies", "New Era fitted cap"), lessons, s).category).toBe("Headwear Inventory");
  });

  it("keeps filing under a renamed category when the AI uses the old name", () => {
    let s = start(photo("a"));
    s = applyClassification(s, "a", answer("Hoodies", "grey hoodie"), newId).state;
    const hoodies = cat(s, "Hoodies");
    s = renameCategory(s, hoodies.id, "Sweatshirt Stock", newId).state;
    expect(cat(s, "Sweatshirt Stock").aliases).toEqual(["Hoodies"]);
    const r = followHabits(answer("Hoodies", "black zip hoodie"), [], s);
    expect(r.category).toBe("Sweatshirt Stock");
    // A narrower kind of the old name goes there too, and nothing new is created.
    const c = applyClassification({ ...s, photos: [...s.photos, photo("b")] }, "b", followHabits(answer("Zip Up Hoodies", "zip hoodie"), [], s), newId);
    expect(c.putCategories).toEqual([]);
  });

  it("remembers the name a category was merged away from", () => {
    let s = start(photo("a"), photo("b"));
    s = applyClassification(s, "a", answer("Grails", "Jordan 4"), newId).state;
    s = applyClassification(s, "b", answer("Sneakers", "Nike Dunk"), newId).state;
    const c = renameCategory(s, cat(s, "Grails").id, "Sneakers", newId);
    s = c.state;
    expect(s.categories.some((x) => x.name === "Grails")).toBe(false);
    expect(cat(s, "Sneakers").aliases).toEqual(["Grails"]);
    expect(c.putCategories.map((x) => x.name)).toContain("Sneakers");
    expect(followHabits(answer("Grails", "Yeezy 350"), [], s).category).toBe("Sneakers");
  });

  it("stops the AI refilling a category the person keeps emptying into another", () => {
    const s = start();
    const shirts = cat(s, "Shirts");
    const lessons = [lesson("Supreme box logo tee", shirts.id, "Shirts", "Streetwear"), lesson("Bape camo shirt", shirts.id, "Shirts", "Streetwear")];
    expect(followHabits(answer("Streetwear", "Stussy graphic tee"), lessons, s).category).toBe("Shirts");
    // One correction isn't a habit yet.
    expect(followHabits(answer("Streetwear", "Stussy graphic tee"), lessons.slice(0, 1), s).category).toBe("Streetwear");
  });

  it("leaves a category that still holds photos alone, even after a few mistakes were moved out", () => {
    let s = start(photo("a"));
    const bags = cat(s, "Bags");
    s = movePhotos(s, ["a"], { categoryId: bags.id }, newId).state;
    const lessons = [lesson("Jordan 1 sneaker", "x", "Sneakers", "Bags"), lesson("Nike Dunk sneaker", "x", "Sneakers", "Bags")];
    expect(followHabits(answer("Bags", "Coach shoulder bag"), lessons, s).category).toBe("Bags");
  });

  it("never turns an answer into a catch-all", () => {
    const s = start();
    const lessons = [lesson("box of stuff", "gone", "Misc")];
    expect(followHabits(answer("Toys", "box of stuff"), lessons, s).category).toBe("Toys");
  });
});

describe("moving look-alikes along with a correction", () => {
  function sorted(s: LibraryState, id: string, category: string, label: string): LibraryState {
    return applyClassification({ ...s, photos: [...s.photos, photo(id)] }, id, answer(category, label), newId).state;
  }

  it("moves AI-filed look-alikes from the same wrong category, and To review look-alikes", () => {
    let s = start();
    s = sorted(s, "a", "Wallets", "Goyard card holder");
    s = sorted(s, "b", "Wallets", "Goyard card holder");
    s = sorted(s, "c", "Wallets", "Prada leather wallet");
    s = applyClassification({ ...s, photos: [...s.photos, photo("d")] }, "d", answer("Wallets", "Goyard card holder", 0.1), newId).state;
    // The person filed this one themselves: it stays.
    s = movePhotos({ ...s, photos: [...s.photos, photo("e", { label: "Goyard card holder" })] }, ["e"], { categoryId: cat(s, "Wallets").id }, newId).state;
    const holders = cat(s, "Card Holders");
    const after = movePhotos(s, ["a"], { categoryId: holders.id }, newId).state;
    expect(alsoMove(s, after, ["a"]).sort()).toEqual(["b", "d"]);
  });

  it("does nothing for a move within the same category or a photo with no description", () => {
    let s = start();
    s = sorted(s, "a", "Wallets", "Goyard card holder");
    s = sorted(s, "b", "Wallets", "Goyard card holder");
    const same = movePhotos(s, ["a"], { categoryId: cat(s, "Wallets").id }, newId).state;
    expect(alsoMove(s, same, ["a"])).toEqual([]);
  });
});

describe("lessons sent with a sort", () => {
  it("cover every category the person taught, not only the newest big move", () => {
    const s = start();
    const shirts = cat(s, "Shirts");
    const bags = cat(s, "Bags");
    const lessons = [
      ...Array.from({ length: 70 }, (_, i) => lesson(`tee ${i}`, shirts.id, "Shirts", undefined, 100 + i)),
      lesson("Coach tote", bags.id, "Bags", "Wallets", 1),
    ];
    const sent = lessonsForPrompt(lessons, s.categories);
    expect(sent).toHaveLength(60);
    expect(sent.some((l) => l.category === "Bags")).toBe(true);
    expect(sent[0].label).toBe("tee 69");
  });

  it("are still learned from a move out of any category, not just To review", () => {
    let s = start(photo("a"));
    s = applyClassification(s, "a", answer("Wallets", "Goyard card holder"), newId).state;
    const after = movePhotos(s, ["a"], { categoryId: cat(s, "Card Holders").id }, newId).state;
    expect(lessonsFromMove(s, after, ["a"], newId)).toMatchObject([{ label: "Goyard card holder", category: "Card Holders", wrongCategory: "Wallets" }]);
  });
});
