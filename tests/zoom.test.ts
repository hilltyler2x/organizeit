import { describe, expect, it } from "vitest";
import { FIT, MAX_ZOOM, clampView, zoomAround } from "../src/ui/zoom";

const image = { w: 400, h: 300 };
const box = { w: 400, h: 600 };

describe("photo zoom", () => {
  it("never zooms out past fitting the photo", () => {
    expect(clampView({ scale: 0.5, x: 40, y: 40 }, image, box)).toEqual(FIT);
    expect(zoomAround({ scale: 2, x: 10, y: 10 }, 0, 0, 1)).toEqual(FIT);
  });

  it("caps how far in it goes", () => {
    expect(clampView({ scale: 50, x: 0, y: 0 }, image, box).scale).toBe(MAX_ZOOM);
  });

  it("keeps the spot under the finger in place when zooming", () => {
    const v = zoomAround(FIT, 100, 50, 2);
    // The point that was at (100, 50) from the centre is still there: (100 - x) / scale = 100 - 0.
    expect((100 - v.x) / v.scale).toBe(100);
    expect((50 - v.y) / v.scale).toBe(50);
  });

  it("stops the photo being dragged off the screen", () => {
    // Twice as big: 800 wide in a 400 box can move 200 either way; 600 tall in a 600 box can't move up or down.
    expect(clampView({ scale: 2, x: 999, y: 999 }, image, box)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(clampView({ scale: 2, x: -999, y: -999 }, image, box)).toEqual({ scale: 2, x: -200, y: 0 });
  });
});
