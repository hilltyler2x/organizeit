import type { Category, Section } from "./types";

// Core rule: there is never an Other / Misc / Uncategorized bucket. Every photo lands in a
// real, specific category, and the list grows when something new shows up.

export const SEED_CATEGORIES: Record<Section, string[]> = {
  business: ["Receipts", "Order Confirmations", "Invoices", "Payment Screens"],
  products: [
    "Bags", "Socks", "Wallets", "Card Holders", "Hats", "Beanies", "Clothing Sets",
    "Shirts", "Shorts", "Pants", "Fragrance", "Belts", "Toys",
  ],
  personal: [],
};

/** Whole names that are catch-alls, compared after normalising. */
const BANNED_NAMES = new Set([
  "other", "others", "misc", "miscellaneous", "uncategorized", "uncategorised", "unsorted",
  "unknown", "unclassified", "unidentified", "general", "generic", "various", "assorted",
  "random", "stuff", "things", "item", "items", "product", "products", "photo", "photos",
  "image", "images", "picture", "pictures", "video", "videos", "clip", "clips", "video clips",
  "recordings", "footage", "media", "none", "na", "n a", "tbd", "todo", "to sort",
  "everything else", "rest", "leftovers", "extras", "more", "new", "new category",
  "category", "default", "mixed", "personal", "business", "business expenses",
]);

/** Words that make any name a catch-all ("Other Accessories", "Misc Shoes", "General Items"). */
const BANNED_WORDS = new Set([
  "other", "others", "misc", "miscellaneous", "uncategorized", "uncategorised", "unsorted",
  "unknown", "unclassified", "assorted", "various", "general", "generic", "random", "etc",
]);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export class BannedCategoryError extends Error {
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is a catch-all name. Every category must name a specific kind of item.`);
    this.name = "BannedCategoryError";
  }
}

export function isBannedCategoryName(name: string): boolean {
  const w = words(name);
  if (w.length === 0) return true;
  if (BANNED_NAMES.has(w.join(" "))) return true;
  return w.some((x) => BANNED_WORDS.has(x) || BANNED_WORDS.has(singular(x)));
}

const SMALL_WORDS = new Set(["and", "or", "of", "for", "the", "a", "an", "in", "on", "with"]);

/** "  phone   CASES " -> "Phone Cases". Keeps acronyms like "USB" as typed. */
export function tidyCategoryName(name: string): string {
  return name
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// Not real English singulars, just a stable key: "beanies"/"beanie" and
// "accessories"/"accessory" both reduce to the same form.
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -1);
  if (word.length > 2 && /[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ie";
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Common alternate names, mapped to the canonical category name. Keys are match keys. */
const SYNONYMS: Record<string, string> = {
  tee: "Shirts", "t shirt": "Shirts", tshirt: "Shirts", top: "Shirts", polo: "Shirts",
  "button up": "Shirts", "button down": "Shirts", jersey: "Shirts",
  cap: "Hats", "baseball cap": "Hats", "snapback": "Hats", "trucker hat": "Hats", "bucket hat": "Hats",
  "knit hat": "Beanies", "winter hat": "Beanies", toque: "Beanies",
  cologne: "Fragrance", perfume: "Fragrance", fragrance: "Fragrance", "eau de parfum": "Fragrance",
  "eau de toilette": "Fragrance", scent: "Fragrance",
  purse: "Bags", handbag: "Bags", backpack: "Bags", tote: "Bags", "tote bag": "Bags",
  "crossbody bag": "Bags", "duffel bag": "Bags", "messenger bag": "Bags",
  "card case": "Card Holders", "card wallet": "Card Holders", cardholder: "Card Holders",
  trouser: "Pants", jean: "Pants", jogger: "Pants", sweatpant: "Pants", chino: "Pants",
  "short": "Shorts",
  set: "Clothing Sets", "matching set": "Clothing Sets", tracksuit: "Clothing Sets", "outfit set": "Clothing Sets",
  sock: "Socks",
  toy: "Toys", "action figure": "Toys", "plush": "Toys", "plushie": "Toys",
  receipt: "Receipts", "order confirmation": "Order Confirmations", "order receipt": "Order Confirmations",
  invoice: "Invoices", bill: "Invoices",
  "payment screen": "Payment Screens", "payment confirmation": "Payment Screens",
  "payment screenshot": "Payment Screens",
};

/** Key used to decide whether two names mean the same category ("Phone Case" == "phone cases"). */
export function categoryMatchKey(name: string): string {
  return words(name).map(singular).join(" ");
}

function canonicalName(name: string): string {
  const key = categoryMatchKey(name);
  return SYNONYMS[key] ?? tidyCategoryName(name);
}

/** Finds a category in `section` that means the same thing as `name`. */
export function findMatchingCategory(
  categories: Category[],
  section: Section,
  name: string,
): Category | undefined {
  const key = categoryMatchKey(canonicalName(name));
  return categories.find((c) => c.section === section && categoryMatchKey(c.name) === key);
}

export interface ResolvedCategory {
  /** The category to file the photo under. New when `created` is true. */
  category: Category;
  created: boolean;
}

/**
 * Turns a proposed category name into a real category: reuses an existing one when the
 * name matches, otherwise creates a new, specific one. Throws BannedCategoryError for
 * catch-all names, which is the only way the core rule can be enforced in one place.
 */
export function resolveCategory(
  categories: Category[],
  section: Section,
  proposedName: string,
  newId: () => string,
  now: number = Date.now(),
): ResolvedCategory {
  if (isBannedCategoryName(proposedName)) throw new BannedCategoryError(proposedName);
  const existing = findMatchingCategory(categories, section, proposedName);
  if (existing) return { category: existing, created: false };
  const name = canonicalName(proposedName);
  if (isBannedCategoryName(name)) throw new BannedCategoryError(proposedName);
  return {
    category: { id: newId(), section, name, seeded: false, createdAt: now },
    created: true,
  };
}

/**
 * Picks the first usable name from the classifier's answer: its category, then a name
 * built from its description of the item. Returns undefined if both are catch-alls.
 */
export function pickCategoryName(category: string, label: string): string | undefined {
  if (!isBannedCategoryName(category)) return category;
  if (isBannedCategoryName(label)) return undefined;
  const fromLabel = pluralize(tidyCategoryName(label));
  if (!isBannedCategoryName(fromLabel) && words(fromLabel).length <= 4) return fromLabel;
  return undefined;
}

export function pluralize(name: string): string {
  const parts = name.split(" ");
  const last = parts[parts.length - 1] ?? "";
  const lower = last.toLowerCase();
  let plural = last;
  if (lower.endsWith("ss")) {
    plural = last + "es";
  } else if (!lower || lower.endsWith("s") || lower === "fragrance" || lower === "jewelry" || lower === "clothing" || lower === "footwear" || lower === "eyewear") {
    plural = last;
  } else if (/[^aeiou]y$/.test(lower)) {
    plural = last.slice(0, -1) + "ies";
  } else if (/(ch|sh|x|z)$/.test(lower)) {
    plural = last + "es";
  } else {
    plural = last + "s";
  }
  parts[parts.length - 1] = plural;
  return parts.join(" ");
}

export function seedCategories(newId: () => string, now: number = Date.now()): Category[] {
  return (Object.keys(SEED_CATEGORIES) as Section[]).flatMap((section) =>
    SEED_CATEGORIES[section].map((name) => ({ id: newId(), section, name, seeded: true, createdAt: now })),
  );
}
