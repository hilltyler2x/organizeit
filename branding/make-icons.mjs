// Renders the app icon and splash screens for iOS, Android and the web from branding/icon.svg.
// Usage: node branding/make-icons.mjs   (needs Playwright: npm i -g playwright, or npm i --no-save playwright)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.join(import.meta.dirname, "..");
const ICON = fs.readFileSync(path.join(import.meta.dirname, "icon.svg"), "utf8");
// The icon is a full-bleed background plus a mark; split them so each platform can place the mark itself.
const inner = ICON.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const defs = inner.match(/<defs>[\s\S]*?<\/defs>/)[0];
const background = inner.match(/<rect width="1024" height="1024"[^>]*\/>/)[0];
const mark = inner.replace(defs, "").replace(background, "");
const svg = (body, viewBox = "0 0 1024 1024") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs}${body}</svg>`;
const scaled = (k) => `<g transform="translate(512 512) scale(${k}) translate(-512 -512)">${mark}</g>`;

const browser = await chromium.launch();

async function render(file, w, h, html, { transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
  // App Store icons must not have an alpha channel.
  if (!transparent) execFileSync("convert", [file, "-alpha", "off", file]);
}

const sized = (s, w, h = w) => s.replace("<svg ", `<svg width="${w}" height="${h}" `);
const out = (...p) => path.join(ROOT, ...p);

// ---- iOS ----
await render(out("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), 1024, 1024, sized(ICON, 1024));

function splash(w, h) {
  const m = Math.round(Math.min(w, h, 1260) * 0.34);
  return `<div style="width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:linear-gradient(160deg,#14b8a6 0%,#0f766e 50%,#134e4a 100%);font-family:Inter,sans-serif">
${sized(svg(mark, "170 170 684 684"), m)}
<div style="color:#fff;font-weight:800;font-size:${Math.round(m * 0.24)}px;letter-spacing:-0.02em;margin-top:${Math.round(m * 0.1)}px">OrganizeIt</div></div>`;
}
for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"])
  await render(out("ios/App/App/Assets.xcassets/Splash.imageset", f), 2732, 2732, splash(2732, 2732));

// ---- Android ----
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITY)) {
  const dir = out(`android/app/src/main/res/mipmap-${d}`);
  const legacy = 48 * k, adaptive = 108 * k;
  await render(path.join(dir, "ic_launcher.png"), legacy, legacy,
    `<div style="width:${legacy}px;height:${legacy}px;border-radius:22%;overflow:hidden">${sized(ICON, legacy)}</div>`, { transparent: true });
  await render(path.join(dir, "ic_launcher_round.png"), legacy, legacy,
    `<div style="width:${legacy}px;height:${legacy}px;border-radius:50%;overflow:hidden">${sized(svg(background + scaled(0.86)), legacy)}</div>`, { transparent: true });
  // Adaptive icon layers: the launcher masks a 108dp square down to its 66dp safe zone.
  await render(path.join(dir, "ic_launcher_foreground.png"), adaptive, adaptive, sized(svg(scaled(0.66)), adaptive), { transparent: true });
  await render(path.join(dir, "ic_launcher_background.png"), adaptive, adaptive, sized(svg(background), adaptive));
}
const SPLASH = {
  drawable: [480, 320],
  "drawable-land-mdpi": [480, 320], "drawable-land-hdpi": [800, 480], "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960], "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480], "drawable-port-hdpi": [480, 800], "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600], "drawable-port-xxxhdpi": [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(SPLASH)) await render(out(`android/app/src/main/res/${dir}/splash.png`), w, h, splash(w, h));

// ---- Web ----
fs.writeFileSync(out("public/icon.svg"), svg(`<clipPath id="r"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#r)">${background}${mark}</g>`));
await render(out("public/apple-touch-icon.png"), 180, 180, sized(ICON, 180));
await render(out("public/icon-512.png"), 512, 512, sized(ICON, 512));
await render(out("public/icon-192.png"), 192, 192, sized(ICON, 192));
await render(out("public/icon-maskable-512.png"), 512, 512, sized(svg(background + scaled(0.8)), 512));

await browser.close();
console.log("icons and splash screens updated");
