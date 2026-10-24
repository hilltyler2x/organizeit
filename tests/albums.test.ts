import { describe, expect, it } from "vitest";
import { defaultAlbumName, tidyAlbumName } from "../src/core/albums";

describe("album names", () => {
  it("names the album after the category", () => {
    expect(defaultAlbumName("Card Holders")).toBe("Big Cartel - Card Holders");
  });

  it("tidies spacing and length", () => {
    expect(tidyAlbumName("  Nike   Dunk  Low \n")).toBe("Nike Dunk Low");
    expect(tidyAlbumName("x".repeat(100))).toHaveLength(60);
    expect(tidyAlbumName("   ")).toBe("");
  });
});
