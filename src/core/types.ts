// Platform-neutral data model. Nothing in src/core touches the DOM, IndexedDB or
// the network, so it can be reused unchanged by a native (Capacitor / React Native) app.

export type Section = "business" | "products" | "personal";

export const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "business", label: "Business Expenses", blurb: "Receipts, order confirmations, invoices and payment screens" },
  { id: "products", label: "Products", blurb: "Reselling inventory, sorted by exact item type" },
  { id: "personal", label: "Personal", blurb: "Everything else, still sorted into specific categories" },
];

export interface Category {
  id: string;
  section: Section;
  name: string;
  /** Seeded categories stay even when empty; AI-created ones are removed once empty. */
  seeded: boolean;
  createdAt: number;
  /** When the person last opened this category. Photos the AI files after this are "new". */
  seenAt?: number;
}

/**
 * "review" means the AI wasn't sure, so the person picks the category. Like "queued" and
 * "error" it is a to-do state, never a category: the photo has no categoryId until it is filed.
 */
export type PhotoStatus = "queued" | "classifying" | "sorted" | "review" | "error";

export interface Photo {
  id: string;
  fileName: string;
  mimeType: string;
  /** Size of the original file in bytes; this is what storage totals add up. */
  bytes: number;
  width: number;
  height: number;
  takenAt: number;
  importedAt: number;
  status: PhotoStatus;
  /** Set once status is "sorted". A sorted photo always has a real category. */
  categoryId?: string;
  /** When the AI filed this photo into its category. Not set when the person filed it. */
  filedAt?: number;
  /** Short description of what is in the photo, from the classifier. */
  label?: string;
  confidence?: number;
  /** The AI's best guess for a photo in "review", offered as a one-tap answer. */
  suggestion?: { section: Section; category: string };
  error?: string;
  /** The device marked this as a screenshot, a strong hint for business expenses. */
  isScreenshot?: boolean;
  /**
   * Fingerprint of what the photo looks like (16 hex digits), used to spot duplicates. Not set
   * until worked out; an empty string means the image couldn't be read.
   */
  hash?: string;
  /** The person said this photo is not a copy of the ones it looks like. */
  notDuplicate?: boolean;
  /** Where the photo came from, so a native build can act on the original asset. */
  source: { kind: "file" } | { kind: "native"; assetId: string };
}

/** What the classifier returns for one photo. */
export interface Classification {
  section: Section;
  category: string;
  label: string;
  confidence: number;
}

/**
 * A correction the person made: a photo the AI described as `label` belongs in `categoryId`.
 * These are sent with later sorts so the AI learns this person's categories.
 */
export interface Lesson {
  id: string;
  label: string;
  categoryId: string;
  /** Section and name when the lesson was made, used if that category is later removed. */
  section: Section;
  category: string;
  /** Name of the category the AI had picked or guessed, when it got it wrong. */
  wrongCategory?: string;
  createdAt: number;
}
