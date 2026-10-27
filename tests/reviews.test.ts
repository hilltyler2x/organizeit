import { describe, expect, it } from "vitest";
import {
  ASK_EVERY_DAYS,
  SETTLE_MS,
  emptyReviewState,
  freedEnough,
  isRegular,
  recordAsk,
  recordOpen,
  shouldAsk,
} from "../src/core/reviews";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date(2026, 9, 27, 12).getTime();

describe("review prompts", () => {
  it("never asks right after the app opens", () => {
    const s = emptyReviewState();
    expect(shouldAsk(s, start + 1000, start, false)).toBe(false);
    expect(shouldAsk(s, start + SETTLE_MS, start, false)).toBe(true);
  });

  it("asks once per visit and waits a few days before asking again", () => {
    const s = recordAsk(emptyReviewState(), start);
    expect(s.asks).toBe(1);
    expect(shouldAsk(emptyReviewState(), start + SETTLE_MS, start, true)).toBe(false);
    const later = start + (ASK_EVERY_DAYS - 1) * DAY;
    expect(shouldAsk(s, later, later - SETTLE_MS, false)).toBe(false);
    const enough = start + ASK_EVERY_DAYS * DAY;
    expect(shouldAsk(s, enough, enough - SETTLE_MS, false)).toBe(true);
  });

  it("counts different days the app was opened to spot a regular user", () => {
    let s = emptyReviewState();
    s = recordOpen(s, start);
    s = recordOpen(s, start + 1000);
    expect(s.days).toHaveLength(1);
    s = recordOpen(s, start + DAY);
    expect(isRegular(s)).toBe(false);
    s = recordOpen(s, start + 5 * DAY);
    expect(isRegular(s)).toBe(true);
    s = recordOpen(s, start + 6 * DAY);
    expect(s.days).toHaveLength(3);
  });

  it("only celebrates freeing a meaningful amount", () => {
    expect(freedEnough(1, 3_000_000)).toBe(false);
    expect(freedEnough(10, 1000)).toBe(true);
    expect(freedEnough(2, 30 * 1024 * 1024)).toBe(true);
  });
});
