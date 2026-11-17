import { describe, expect, it } from "vitest";
import { CLASSIFIER_MAX_PIXELS, CLASSIFIER_MAX_SIDE, classifierSide } from "../src/lib/quality";

// Ceiling patches of 28px, as Claude counts vision tokens; it reads at most 4,784 per image.
const tokens = (w: number, h: number) => Math.ceil(w / 28) * Math.ceil(h / 28);
const sized = (w: number, h: number) => {
  const scale = Math.min(1, classifierSide(w, h) / Math.max(w, h));
  return [Math.round(w * scale), Math.round(h * scale)];
};

describe("classifier image size", () => {
  it("sends a 12 MP camera photo as large as the AI reads, within its limits", () => {
    const [w, h] = sized(4032, 3024);
    expect(w * h).toBeLessThanOrEqual(CLASSIFIER_MAX_PIXELS + 5000);
    expect(w * h).toBeGreaterThan(3_400_000);
    expect(tokens(w, h)).toBeLessThanOrEqual(4784);
  });

  it("sends an iPhone screenshot at full size", () => {
    expect(sized(1188, 2576)).toEqual([1188, 2576]);
    expect(sized(1320, 2868)[1]).toBeLessThanOrEqual(CLASSIFIER_MAX_SIDE);
    const [w, h] = sized(1320, 2868);
    expect(tokens(w, h)).toBeLessThanOrEqual(4784);
  });

  it("never enlarges a small photo and caps very long ones at the long-side limit", () => {
    expect(sized(800, 600)).toEqual([800, 600]);
    expect(classifierSide(1000, 12000)).toBe(CLASSIFIER_MAX_SIDE);
  });

  it("falls back to a size that fits even a square photo when the size is unknown", () => {
    const side = classifierSide(0, 0);
    expect(side * side).toBeLessThanOrEqual(CLASSIFIER_MAX_PIXELS);
    expect(tokens(1920, 1920)).toBeLessThanOrEqual(4784); // video frame grid
  });
});
