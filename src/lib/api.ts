import type { LessonForPrompt } from "../core/lessons";
import type { Category, Classification } from "../core/types";

// Base URL of the API server. Empty on the website (same origin); a native build sets
// VITE_API_URL to the deployed server.
export const API = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly reason?: string) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

let passcodeKey = "organizeit.passcode";

function readPasscode() {
  try {
    return localStorage.getItem(passcodeKey) ?? "";
  } catch {
    return "";
  }
}

let passcode = readPasscode();

/**
 * Once the app sells subscriptions, a passcode entered before then no longer counts on the
 * phone: customers subscribe, and the owner enters the passcode again from the subscribe screen
 * to skip it. That way an owner's phone can try the purchase flow too.
 */
export function subscriptionMode() {
  if (passcodeKey === "organizeit.ownerPasscode") return;
  passcodeKey = "organizeit.ownerPasscode";
  passcode = readPasscode();
}

// The person's RevenueCat id inside the iOS/Android app, so the server can check their subscription.
let userId = "";
export function setUserId(id: string) {
  userId = id;
}
export function currentUserId() {
  return userId;
}

function authHeaders(): Record<string, string> {
  return { "x-organizeit-passcode": passcode, ...(userId ? { "x-organizeit-user": userId } : {}) };
}

export function hasPasscode() {
  return passcode !== "";
}

/** The remembered passcode, handed to the phone so it can sort while the app is closed. */
export function currentPasscode() {
  return passcode;
}

export type ServerStatus = { reachable: boolean; ai: boolean; passcodeRequired: boolean; subscriptions: boolean };

/**
 * Asks the server whether AI sorting is set up. `reachable` is false while the server is
 * down or still waking up (the free Render plan sleeps when idle and takes about a minute to
 * start), so callers should keep checking rather than treat that as "no AI".
 */
export async function serverStatus(): Promise<ServerStatus> {
  try {
    // Kept short: the app checks again every 10 seconds until one gets through, and Render
    // answers a request made once it has woken up.
    const r = await fetch(`${API}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const body = await r.json();
    if (!r.ok) return { reachable: false, ai: false, passcodeRequired: false, subscriptions: false };
    return { reachable: true, ai: body.ai === true, passcodeRequired: body.passcodeRequired === true, subscriptions: body.subscriptions === true };
  } catch {
    return { reachable: false, ai: false, passcodeRequired: false, subscriptions: false };
  }
}

export type Subscription = {
  active: boolean;
  /** In the discounted first month. */
  intro: boolean;
  /** Photos sorted this billing period, and how many it includes (0 = no limit). */
  used: number;
  limit: number;
  expires: number | null;
  cancelled: boolean;
  /** Free photos sorted on this phone before subscribing, out of how many. */
  freeUsed: number;
  freeLimit: number;
};

/** What the server knows about this person's subscription. `fresh` skips its short cache (after a purchase). */
export async function subscriptionStatus(fresh = false): Promise<Subscription | null> {
  try {
    const r = await fetch(`${API}/api/subscription${fresh ? "?fresh=1" : ""}`, { cache: "no-store", headers: authHeaders() });
    return r.ok ? ((await r.json()) as Subscription) : null;
  } catch {
    return null;
  }
}

/** Checks a passcode with the server and remembers it on this device if it works. */
export async function unlock(candidate: string): Promise<boolean> {
  const r = await fetch(`${API}/api/unlock`, {
    method: "POST",
    headers: { "x-organizeit-passcode": candidate, ...(userId ? { "x-organizeit-user": userId } : {}) },
  });
  if (r.status === 429) throw new ApiError("Too many wrong tries. Try again in an hour.", 429);
  if (!r.ok) return false;
  passcode = candidate;
  try {
    localStorage.setItem(passcodeKey, candidate);
  } catch {
    // Private browsing: remembered for this visit only.
  }
  return true;
}

export async function classify(input: {
  image: string;
  mediaType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
  isScreenshot: boolean;
  categories: Category[];
  lessons: LessonForPrompt[];
}): Promise<Classification> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/classify`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        ...input,
        categories: input.categories.map((c) => ({ section: c.section, name: c.name })),
      }),
    });
  } catch {
    throw new ApiError("Could not reach the OrganizeIt server.", 0);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status})`, r.status, body.reason);
  return body as Classification;
}

export type PhotoForClassifier = {
  image: string;
  mediaType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
  isScreenshot: boolean;
  /** The image is a grid of frames from a video. */
  isVideo?: boolean;
  durationSec?: number;
};

/**
 * Classifies several photos in one request. Results come back in the same order; a photo the
 * AI couldn't place gets `{ error }` instead.
 */
export async function classifyBatch(input: {
  photos: PhotoForClassifier[];
  categories: Category[];
  lessons: LessonForPrompt[];
}): Promise<(Classification | { error: string })[]> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/classify-batch`, {
      method: "POST",
      // A request that hangs (dropped connection, frozen in the background) is given up on
      // and retried rather than holding its photos forever.
      signal: AbortSignal.timeout(180_000),
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        ...input,
        categories: input.categories.map((c) => ({ section: c.section, name: c.name })),
      }),
    });
  } catch {
    throw new ApiError("Could not reach the OrganizeIt server.", 0);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status})`, r.status, body.reason);
  if (!Array.isArray(body.results) || body.results.length !== input.photos.length) {
    throw new ApiError("The server sent back the wrong number of answers.", 502);
  }
  return body.results;
}
