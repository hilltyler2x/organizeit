import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  emptyReviewState,
  isRegular,
  recordAsk,
  recordOpen,
  shouldAsk,
  type HappyMoment,
  type ReviewState,
} from "../core/reviews";

// Asks for an App Store / Google Play review at happy moments (see src/core/reviews.ts), using
// the phone's own review sheet from native/photo-library. Only inside the iOS/Android app; the
// website never asks.

interface AppReviewPlugin {
  /** Asks the phone to show its review sheet. The phone may decide not to. */
  requestReview(): Promise<void>;
  /** Opens OrganizeIt's page in the App Store (`appStoreId`) or Google Play to write a review. */
  openStore(options: { appStoreId?: string }): Promise<void>;
}

const AppReview = registerPlugin<AppReviewPlugin>("AppReview");

const platform = Capacitor.getPlatform();
/** OrganizeIt's Apple ID from App Store Connect (App Information), for the iPhone "Rate" link. */
const appStoreId = import.meta.env.VITE_APP_STORE_ID as string | undefined;

/** Whether the menu can offer "Rate OrganizeIt". */
export const canRate = platform === "android" || (platform === "ios" && !!appStoreId);

const KEY = "organizeit.reviews";
// Wait a moment after the happy thing so a delete confirmation or notice can settle first.
const ASK_DELAY_MS = 1500;
// A regular user is asked a minute into a visit, not on opening.
const REGULAR_AFTER_MS = 60_000;

function load(): ReviewState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved && Array.isArray(saved.days) ? saved : emptyReviewState();
  } catch {
    return emptyReviewState();
  }
}

function save(state: ReviewState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private storage unavailable: may ask a little sooner next time, which the phone limits anyway.
  }
}

let openedAt = Date.now();
let askedThisSession = false;
let regularTimer: number | undefined;

function opened() {
  openedAt = Date.now();
  const state = recordOpen(load(), openedAt);
  save(state);
  window.clearTimeout(regularTimer);
  if (isRegular(state)) regularTimer = window.setTimeout(() => happyMoment("regular"), REGULAR_AFTER_MS);
}

/** Starts counting visits. Called once when the app starts. */
export function startReviews() {
  if (!Capacitor.isNativePlatform()) return;
  opened();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") opened();
    else window.clearTimeout(regularTimer);
  });
}

/** Something good just happened: ask for a review if it's been long enough since the last ask. */
export function happyMoment(_moment: HappyMoment) {
  if (!Capacitor.isNativePlatform() || document.visibilityState !== "visible") return;
  const state = load();
  if (!shouldAsk(state, Date.now(), openedAt, askedThisSession)) return;
  askedThisSession = true;
  save(recordAsk(state, Date.now()));
  window.setTimeout(() => {
    if (document.visibilityState === "visible") AppReview.requestReview().catch(() => {});
  }, ASK_DELAY_MS);
}

/** Opens the store page to write a review, from the menu. */
export function rateApp() {
  return AppReview.openStore({ appStoreId });
}
