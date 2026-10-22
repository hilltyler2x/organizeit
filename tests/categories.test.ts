import { describe, expect, it } from "vitest";
import {
  BannedCategoryError,
  SEED_CATEGORIES,
  isBannedCategoryName,
  pickCategoryName,
  resolveCategory,
  seedCategories,
} from "../src/core/categories";

let n = 0;
const newId = () => `id${++n}`;

describe("core rule: no catch-all categories", () => {
  it.each([
    "Other", "other", "OTHERS", "Misc", "misc.", "Miscellaneous", "Uncategorized", "Uncategorised", "Unknown",
    "Other Accessories", "Misc Shoes", "General Items", "Assorted", "Various Things", "Random", "Stuff", "Items",
    "", "   ", "---", "Everything Else", "N/A", "Unsorted Photos",
  ])("rejects %j", (name) => {
    expect(isBannedCategoryName(name)).toBe(true);
  });

  it.each(["Sneakers", "Sunglasses", "Jewelry", "Phone Cases", "Card Holders", "Shipping Labels", "Pets", "Mothers Day Cards"])(
    "allows %j",
    (name) => expect(isBannedCategoryName(name)).toBe(false),
  );

  it("no seed category is a catch-all", () => {
    for (const names of Object.values(SEED_CATEGORIES)) for (const name of names) expect(isBannedCategoryName(name)).toBe(false);
  });

  it("resolveCategory refuses to create a catch-all", () => {
    expect(() => resolveCategory(seedCategories(newId), "products", "Other", newId)).toThrow(BannedCategoryError);
    expect(() => resolveCategory(seedCategories(newId), "products", "misc items", newId)).toThrow(BannedCategoryError);
  });

  it("falls back to the item description when the AI answers with a catch-all", () => {
    expect(pickCategoryName("Other", "phone case")).toBe("Phone Cases");
    expect(pickCategoryName("Misc", "sunglass")).toBe("Sunglasses");
    expect(pickCategoryName("Other", "unknown item")).toBeUndefined();
  });
});

describe("resolveCategory", () => {
  const cats = seedCategories(newId);

  it("seeds the requested product categories", () => {
    expect(cats.filter((c) => c.section === "products").map((c) => c.name)).toEqual([
      "Bags", "Socks", "Wallets", "Card Holders", "Hats", "Beanies", "Clothing Sets", "Shirts", "Shorts", "Pants", "Fragrance", "Belts", "Toys",
    ]);
  });

  it.each([
    ["bags", "Bags"], ["Bag", "Bags"], ["card holder", "Card Holders"], ["T-Shirt", "Shirts"], ["Tees", "Shirts"],
    ["Cologne", "Fragrance"], ["perfume", "Fragrance"], ["Baseball Caps", "Hats"], ["purse", "Bags"], ["Jeans", "Pants"],
  ])("matches %j to existing %j", (input, expected) => {
    const r = resolveCategory(cats, "products", input, newId);
    expect(r.created).toBe(false);
    expect(r.category.name).toBe(expected);
  });

  it("creates a new, tidy category when nothing fits", () => {
    const r = resolveCategory(cats, "products", "  sneakers ", newId);
    expect(r.created).toBe(true);
    expect(r.category).toMatchObject({ name: "Sneakers", section: "products", seeded: false });
  });

  it("reuses a category created earlier, ignoring plural and case", () => {
    const first = resolveCategory(cats, "products", "Phone Cases", newId);
    const again = resolveCategory([...cats, first.category], "products", "phone case", newId);
    expect(again.created).toBe(false);
    expect(again.category.id).toBe(first.category.id);
  });

  it("keeps sections separate", () => {
    const r = resolveCategory(cats, "personal", "Hats", newId);
    expect(r.created).toBe(true);
    expect(r.category.section).toBe("personal");
  });

  it("matches business expense types", () => {
    expect(resolveCategory(cats, "business", "receipt", newId).category.name).toBe("Receipts");
    expect(resolveCategory(cats, "business", "Order Confirmation", newId).category.name).toBe("Order Confirmations");
  });
});
