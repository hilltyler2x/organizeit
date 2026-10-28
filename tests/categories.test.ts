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

describe("no duplicate or look-alike categories", () => {
  const cats = seedCategories(newId);
  const withNew = (...names: string[]) => {
    let list = cats;
    for (const name of names) list = [...list, resolveCategory(list, "products", name, newId).category];
    return list;
  };

  it.each([
    ["Tee Shirts", "Shirts"], ["Men's T-Shirts", "Shirts"], ["Polo Shirts", "Shirts"], ["Graphic Tees", "Shirts"],
    ["Cardholders", "Card Holders"], ["Leather Card Holders", "Card Holders"], ["Basketball Shorts", "Shorts"],
    ["Hats & Caps", "Hats"], ["Snapbacks", "Hats"], ["Knit Caps", "Beanies"], ["Winter Hats", "Beanies"],
    ["Perfumes", "Fragrance"], ["Women's Handbags", "Bags"], ["Belt Bags", "Bags"], ["Vintage Bags", "Bags"],
    ["Bag Photos", "Bags"], ["Bifold Wallets", "Wallets"], ["Card Wallets", "Card Holders"], ["Sweatpants", "Pants"],
    ["Tracksuits", "Clothing Sets"], ["Plushies", "Toys"], ["Stuffed Animals", "Toys"],
  ])("files %j under existing %j", (input, expected) => {
    const r = resolveCategory(cats, "products", input, newId);
    expect(r.created).toBe(false);
    expect(r.category.name).toBe(expected);
  });

  it.each([
    ["Shoes", "Sneakers"], ["Running Shoes", "Sneakers"], ["Footwear", "Sneakers"], ["sneaker", "Sneakers"],
    ["Shades", "Sunglasses"], ["Jewellery", "Jewelry"], ["iPhone Cases", "Phone Cases"], ["Hoody", "Hoodies"],
  ])("files %j under a created %j", (input, existing) => {
    const list = withNew(existing);
    const r = resolveCategory(list, "products", input, newId);
    expect(r.created).toBe(false);
    expect(r.category.name).toBe(existing);
  });

  it("names a new category after its group, so the next look-alike finds it", () => {
    const first = resolveCategory(cats, "products", "Shoes", newId);
    expect(first.category.name).toBe("Sneakers");
    expect(resolveCategory([...cats, first.category], "products", "Trainers", newId).category.id).toBe(first.category.id);
  });

  it("matches narrower business records", () => {
    expect(resolveCategory(cats, "business", "Gas Receipts", newId).category.name).toBe("Receipts");
    expect(resolveCategory(cats, "business", "Amazon Order Confirmations", newId).category.name).toBe("Order Confirmations");
    expect(resolveCategory(cats, "business", "Checkout Screens", newId).category.name).toBe("Payment Screens");
    expect(resolveCategory(cats, "business", "Receipt Screenshots", newId).category.name).toBe("Receipts");
  });

  it.each(["Lego Sets", "Bottle Caps", "Golf Tees", "Boots", "Sweaters", "Jackets", "Skirts", "Gloves", "Dress Socks Box"])(
    "still creates a specific new category for %j",
    (input) => {
      const r = resolveCategory(cats, "products", input, newId);
      expect(r.created).toBe(true);
    },
  );

  it("keeps the seed categories apart from each other", () => {
    for (const c of cats) {
      const others = cats.filter((o) => o.id !== c.id);
      expect(resolveCategory(others, c.section, c.name, newId).created).toBe(true);
    }
  });

  it("only merges narrower kinds outside Personal", () => {
    const pets = resolveCategory(cats, "personal", "Dogs", newId).category;
    expect(resolveCategory([...cats, pets], "personal", "Hot Dogs", newId).created).toBe(true);
  });
});
