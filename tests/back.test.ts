import { describe, expect, it } from "vitest";
import { BackLayer, goBack, onBack } from "../src/ui/back";

describe("Back button", () => {
  it("leaves the app when nothing is open", () => {
    expect(goBack()).toBe(false);
  });

  it("closes the top-most layer first, then the newest of equals", () => {
    const closed: string[] = [];
    const offs = [
      onBack(BackLayer.dialog, () => closed.push("viewer")),
      onBack(BackLayer.page, () => closed.push("category")),
      onBack(BackLayer.dialog, () => closed.push("move")),
      onBack(BackLayer.select, () => closed.push("select")),
    ];
    expect(goBack()).toBe(true);
    expect(closed).toEqual(["move"]);
    offs[2]();
    goBack();
    offs[0]();
    goBack();
    offs[3]();
    goBack();
    offs[1]();
    expect(closed).toEqual(["move", "viewer", "select", "category"]);
    expect(goBack()).toBe(false);
  });
});
