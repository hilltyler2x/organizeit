// How big and how sharp the picture sent to the AI is. Tyler's rule: always high quality.
//
// Claude reads an image at up to 2576 pixels on its long side and about 3.75 million pixels
// (4,784 vision tokens) in all; anything bigger is shrunk by Anthropic before the AI sees it,
// so sending more only adds upload time. Each photo goes up as large as fits inside both
// limits (never enlarged), as a JPEG at quality 0.92. The full-size original stays on the phone.
// The native background sorters (BackgroundSorter.swift / .java) use the same numbers.

/** Longest side the AI reads, in pixels. */
export const CLASSIFIER_MAX_SIDE = 2576;
/** Pixel budget per image, a little under the AI's ~3.75 MP so rounding never tips it over. */
export const CLASSIFIER_MAX_PIXELS = 3_600_000;
/** JPEG quality for the AI's copy. */
export const CLASSIFIER_QUALITY = 0.92;

/**
 * The `maxSide` to ask for so a `width`×`height` photo fits the AI's limits as large as
 * possible. Unknown sizes get a side that keeps even a square photo inside the budget.
 */
export function classifierSide(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return Math.floor(Math.sqrt(CLASSIFIER_MAX_PIXELS));
  const long = Math.max(width, height);
  const byPixels = Math.floor(long * Math.sqrt(CLASSIFIER_MAX_PIXELS / (width * height)));
  return Math.min(CLASSIFIER_MAX_SIDE, byPixels);
}
