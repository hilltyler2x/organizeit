import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without types
import { build } from "../scripts/seo/build.mjs";
// @ts-expect-error plain .mjs content file without types
import { pages } from "../scripts/seo/pages.mjs";

describe("public guide pages", () => {
  it("are up to date with scripts/seo/pages.mjs (run `node scripts/seo/build.mjs`)", () => {
    for (const [file, text] of build() as Map<string, string>) {
      expect(readFileSync(file, "utf8"), file).toBe(text);
    }
  });

  it("are all in the sitemap", () => {
    const sitemap = readFileSync("public/sitemap.xml", "utf8");
    for (const p of pages as { slug: string }[]) expect(sitemap).toContain(`/guides/${p.slug}<`);
  });

  it("never mention a catch-all category as something the app uses", () => {
    for (const [, text] of build() as Map<string, string>) {
      expect(text).not.toMatch(/\bgoes? to (Other|Misc|Uncategorized)\b/i);
    }
  });

  it("robots.txt lets AI crawlers in and points to the sitemap", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    for (const bot of ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Bingbot"]) expect(robots).toContain(`User-agent: ${bot}`);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    expect(robots).toContain("Sitemap: https://organizeit-93mu.onrender.com/sitemap.xml");
  });
});
