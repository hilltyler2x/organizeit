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
    .replace(/['’]/g, "")
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

/**
 * Names that mean the same kind of thing. The first name of each group is the one a new
 * category gets, and any category named after one of them takes in the whole group: if the
 * person already has "Shoes", a photo the AI files as "Sneakers" goes there.
 */
const SYNONYM_GROUPS: string[][] = [
  ["Shirts", "Tee", "T Shirt", "Tshirt", "Top", "Polo", "Button Up", "Button Down", "Jersey", "Blouse", "Tank Top",
    "Long Sleeve", "Long Sleeve Shirt", "Graphic Tee", "Dress Shirt"],
  ["Hats", "Cap", "Baseball Cap", "Snapback", "Fitted", "Fitted Hat", "Trucker Hat", "Trucker Cap", "Bucket Hat", "Dad Hat"],
  ["Beanies", "Knit Hat", "Winter Hat", "Toque", "Knit Cap", "Skull Cap", "Beanie Hat"],
  ["Fragrance", "Cologne", "Perfume", "Parfum", "Eau de Parfum", "Eau de Toilette", "Scent", "Fragrance Bottle"],
  ["Bags", "Purse", "Handbag", "Backpack", "Tote", "Tote Bag", "Crossbody", "Crossbody Bag", "Duffel Bag", "Duffle Bag",
    "Messenger Bag", "Shoulder Bag", "Clutch", "Satchel", "Fanny Pack", "Belt Bag", "Sling Bag"],
  ["Wallets", "Billfold", "Bifold", "Bifold Wallet", "Trifold", "Trifold Wallet"],
  ["Card Holders", "Card Case", "Card Wallet", "Card Sleeve"],
  ["Pants", "Trouser", "Jean", "Jogger", "Sweatpant", "Chino", "Slack", "Cargo Pant"],
  ["Shorts", "Short"],
  ["Clothing Sets", "Set", "Matching Set", "Tracksuit", "Outfit Set", "Outfit", "Two Piece Set", "Sweatsuit"],
  ["Socks", "Sock Pair", "Crew Sock", "Ankle Sock"],
  ["Belts", "Belt Buckle", "Waist Belt"],
  ["Toys", "Action Figure", "Plush", "Plushie", "Stuffed Animal", "Figurine", "Collectible Figure"],
  ["Sneakers", "Shoe", "Footwear", "Trainer", "Kick", "Running Shoe", "Athletic Shoe", "Tennis Shoe"],
  ["Sunglasses", "Shade", "Sunnies", "Sunglass"],
  ["Jewelry", "Jewellery", "Jewel"],
  ["Phone Cases", "Phone Cover", "iPhone Case", "Cell Phone Case"],
  ["Hoodies", "Hoody", "Hooded Sweatshirt", "Zip Up Hoodie", "Pullover Hoodie"],
  ["Jackets", "Coat", "Outerwear", "Windbreaker"],
  ["Watches", "Wristwatch", "Timepiece"],
  ["Receipts", "Receipt Photo", "Store Receipt", "Purchase Receipt", "Paper Receipt"],
  ["Order Confirmations", "Order Receipt", "Order Confirmation Email", "Order Summary", "Order Details"],
  ["Invoices", "Bill"],
  ["Payment Screens", "Payment Confirmation", "Payment Screenshot", "Payment", "Payment Receipt", "Checkout Screen", "Checkout"],
  ["Shipping Labels", "Shipping Label Receipt", "Postage Label", "Postage"],
  ["Pets", "Pet", "Pet Photo"],
  ["Food", "Meal", "Dish", "Food Photo"],
  ["Memes", "Meme", "Funny Picture"],
];

/**
 * Words that don't change what kind of item something is: who it's for, its condition, or
 * that it's a photo of it. "Men's Vintage Hats" and "Hat Photos" are both just Hats.
 */
const FILLER_WORDS = new Set([
  "men", "man", "women", "woman", "ladie", "kid", "child", "children", "boy", "girl", "babie", "unisex", "adult",
  "vintage", "designer", "luxury", "used", "pre", "owned", "preowned", "new", "authentic", "branded", "brand",
  "item", "product", "photo", "picture", "pic", "image", "shot", "screenshot",
]);

/**
 * One-word synonyms too loose to count when they end a longer name: "Lego Sets" are not
 * Clothing Sets and "Bottle Caps" are not Hats.
 */
const LOOSE_TAILS = new Set(["set", "cap", "top", "tee", "bill", "scent", "outfit", "payment", "checkout", "dish", "shade", "kick", "jean", "slack", "fitted"]);

/** Words of a name reduced to a comparable form: lower case, singular, filler removed. */
function matchWords(name: string): string[] {
  const all = words(name).map(singular);
  const kept = all.filter((w) => !FILLER_WORDS.has(w));
  return kept.length ? kept : all;
}

const keyOf = (ws: string[]) => ws.join("");

// Match key of every synonym -> match key of its group's first name.
const SYNONYM_KEYS = new Map<string, string>();
const CANONICAL_NAMES = new Map<string, string>();
for (const [first, ...rest] of SYNONYM_GROUPS) {
  const target = keyOf(matchWords(first));
  CANONICAL_NAMES.set(target, first);
  for (const name of [first, ...rest]) SYNONYM_KEYS.set(keyOf(matchWords(name)), target);
}

const conceptOf = (ws: string[]) => SYNONYM_KEYS.get(keyOf(ws)) ?? keyOf(ws);

/**
 * Key used to decide whether two names mean the same category. Case, plurals, spacing
 * ("Card Holder" / "Cardholders"), filler words and known synonyms ("Tee" / "Shirts") all
 * reduce to the same key.
 */
export function categoryMatchKey(name: string): string {
  return conceptOf(matchWords(name));
}

function canonicalName(name: string): string {
  return CANONICAL_NAMES.get(categoryMatchKey(name)) ?? tidyCategoryName(name);
}

/** Splits "Hats & Caps" or "Socks / Underwear" into its parts. */
function nameParts(name: string): string[] {
  return name.split(/\s+(?:and|or|&)\s+|\s*[/,+]\s*/i).map((p) => p.trim()).filter(Boolean);
}

/**
 * Finds a category in `section` that means the same thing as `name`: the same name in other
 * words, or, for products and business records, a narrower kind of it ("Basketball Shorts"
 * goes in Shorts, "Gas Receipts" in Receipts). A name joining two kinds ("Hats & Caps") goes
 * to the first part that already has a category.
 */
export function findMatchingCategory<C extends { section: Section; name: string }>(
  categories: C[],
  section: Section,
  name: string,
): C | undefined {
  const inSection = categories.filter((c) => c.section === section);
  const keys = new Map<string, C>();
  for (const c of inSection) {
    const k = categoryMatchKey(c.name);
    if (!keys.has(k)) keys.set(k, c);
  }
  const match = (n: string): C | undefined => {
    const ws = matchWords(n);
    const exact = keys.get(conceptOf(ws));
    if (exact || section === "personal") return exact;
    for (let i = 1; i < ws.length; i++) {
      const tail = ws.slice(i);
      if (tail.length === 1 && LOOSE_TAILS.has(tail[0])) continue;
      const found = keys.get(conceptOf(tail));
      if (found) return found;
    }
    return undefined;
  };
  const whole = match(name);
  if (whole) return whole;
  const parts = nameParts(name);
  if (parts.length < 2) return undefined;
  for (const part of parts) {
    const found = match(part);
    if (found) return found;
  }
  return undefined;
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
