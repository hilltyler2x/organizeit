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
}

export type PhotoStatus = "queued" | "classifying" | "sorted" | "error";

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
  /** Short description of what is in the photo, from the classifier. */
  label?: string;
  confidence?: number;
  error?: string;
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
