// When to ask for an App Store / Google Play review. OrganizeIt asks often, but only right
// after something good happened (a big sort finished, space freed, a regular user), never
// when the app opens. The phone's own review sheet is used, which iOS and Android limit on
// their own (iOS shows it at most 3 times a year), so asking often never nags.

/** Something good that just happened. */
export type HappyMoment =
  /** A round of sorting finished with at least SORTED_ENOUGH photos filed. */
  | "sorted"
  /** The person deleted photos and freed a good amount of space. */
  | "freed"
  /** The person keeps coming back: used on REGULAR_DAYS different days. */
  | "regular";

export interface ReviewState {
  /** Days (YYYY-MM-DD, local) the app was opened, most recent last, at most REGULAR_DAYS kept. */
  days: string[];
  /** When the review sheet was last asked for (ms), if ever. */
  lastAskedAt?: number;
  /** How many times it has been asked for. */
  asks: number;
}

/** No asking until the app has been open this long, so it never comes up on opening. */
export const SETTLE_MS = 30_000;
/** Days between asks. The phone decides whether its sheet actually shows. */
export const ASK_EVERY_DAYS = 3;
export const SORTED_ENOUGH = 20;
export const FREED_PHOTOS = 10;
export const FREED_BYTES = 25 * 1024 * 1024;
export const REGULAR_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

export const emptyReviewState = (): ReviewState => ({ days: [], asks: 0 });

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Records that the app was opened today. */
export function recordOpen(state: ReviewState, now: number): ReviewState {
  const today = dayKey(now);
  if (state.days.at(-1) === today) return state;
  return { ...state, days: [...state.days, today].slice(-REGULAR_DAYS) };
}

export function isRegular(state: ReviewState): boolean {
  return state.days.length >= REGULAR_DAYS;
}

/** Whether deleting this many photos and bytes is worth celebrating. */
export function freedEnough(count: number, bytes: number): boolean {
  return count >= FREED_PHOTOS || bytes >= FREED_BYTES;
}

/**
 * Whether to show the review sheet for a happy moment. `openedAt` is when the app was opened
 * (or came back to the foreground); `askedThisSession` stops a second ask before it closes.
 */
export function shouldAsk(state: ReviewState, now: number, openedAt: number, askedThisSession: boolean): boolean {
  if (askedThisSession) return false;
  if (now - openedAt < SETTLE_MS) return false;
  if (state.lastAskedAt !== undefined && now - state.lastAskedAt < ASK_EVERY_DAYS * DAY) return false;
  return true;
}

export function recordAsk(state: ReviewState, now: number): ReviewState {
  return { ...state, lastAskedAt: now, asks: state.asks + 1 };
}
