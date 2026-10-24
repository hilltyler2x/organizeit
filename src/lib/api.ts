import type { LessonForPrompt } from "../core/lessons";
import type { Category, Classification } from "../core/types";

// Base URL of the API server. Empty on the website (same origin); a native build sets
// VITE_API_URL to the deployed server.
export const API = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

const PASSCODE_KEY = "organizeit.passcode";

let passcode = (() => {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? "";
  } catch {
    return "";
  }
})();

export function hasPasscode() {
  return passcode !== "";
}

/** The remembered passcode, handed to the phone so it can sort while the app is closed. */
export function currentPasscode() {
  return passcode;
}

export type ServerStatus = { reachable: boolean; ai: boolean; passcodeRequired: boolean };

/**
 * Asks the server whether AI sorting is set up. `reachable` is false while the server is
 * down or still waking up (the free Render plan sleeps when idle and takes about a minute to
 * start), so callers should keep checking rather than treat that as "no AI".
 */
export async function serverStatus(): Promise<ServerStatus> {
  try {
    const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(90_000) });
    const body = await r.json();
    if (!r.ok) return { reachable: false, ai: false, passcodeRequired: false };
    return { reachable: true, ai: body.ai === true, passcodeRequired: body.passcodeRequired === true };
  } catch {
    return { reachable: false, ai: false, passcodeRequired: false };
  }
}

/** Checks a passcode with the server and remembers it on this device if it works. */
export async function unlock(candidate: string): Promise<boolean> {
  const r = await fetch(`${API}/api/unlock`, {
    method: "POST",
    headers: { "x-organizeit-passcode": candidate },
  });
  if (!r.ok) return false;
  passcode = candidate;
  try {
    localStorage.setItem(PASSCODE_KEY, candidate);
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
      headers: { "content-type": "application/json", "x-organizeit-passcode": passcode },
      body: JSON.stringify({
        ...input,
        categories: input.categories.map((c) => ({ section: c.section, name: c.name })),
      }),
    });
  } catch {
    throw new ApiError("Could not reach the OrganizeIt server.", 0);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status})`, r.status);
  return body as Classification;
}

export type PhotoForClassifier = {
  image: string;
  mediaType: "image/jpeg";
  fileName: string;
  width: number;
  height: number;
  isScreenshot: boolean;
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
      headers: { "content-type": "application/json", "x-organizeit-passcode": passcode },
      body: JSON.stringify({
        ...input,
        categories: input.categories.map((c) => ({ section: c.section, name: c.name })),
      }),
    });
  } catch {
    throw new ApiError("Could not reach the OrganizeIt server.", 0);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error ?? `Request failed (${r.status})`, r.status);
  if (!Array.isArray(body.results) || body.results.length !== input.photos.length) {
    throw new ApiError("The server sent back the wrong number of answers.", 502);
  }
  return body.results;
}
