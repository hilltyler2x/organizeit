// Writes a small camera roll of demo photos (products, receipts, scenery) as JPEG files, for
// recording the Android background-sorting demo video on an emulator.
// Usage: node branding/store/demo-photos.mjs <out-dir> [count]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { items, palettes, backdrops, scenes } from "./products.mjs";
import * as biz from "./business.mjs";

const OUT = process.argv[2] ?? path.join(import.meta.dirname, "out", "demo-photos");
const COUNT = Number(process.argv[3] ?? 90);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function jpeg(svgOrHtml, w, h, scale = 1) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.setContent(svgOrHtml.startsWith("<svg") ? `<body style="margin:0">${svgOrHtml.replace("<svg ", `<svg width="${w}" height="${h}" `)}</body>` : svgOrHtml);
  const buf = await p.screenshot({ type: "jpeg", quality: 85 });
  await p.close();
  return buf;
}

const product = (name) => (i) => jpeg(items[name](palettes[i % 8], backdrops[(i * 3 + 1) % 8]), 900, 900);
const RECEIPTS = [
  { store: "Packwell Supply", date: "Oct 18, 2026", items: [["Poly mailers 100ct", 18.99], ["Bubble wrap roll", 12.49], ["Packing tape x3", 9.97]] },
  { store: "Bluebird Thrift", date: "Oct 12, 2026", items: [["Leather tote", 24.0], ["Wool beanie", 6.0], ["Sneakers", 18.0]] },
  { store: "Northside Outlet", date: "Oct 3, 2026", items: [["Caps 3 for 2", 30.0], ["Sunglasses", 12.99]] },
];
const MAKERS = [
  product("sneaker"),
  product("tote"),
  product("cap"),
  product("sunglasses"),
  (i) => jpeg(biz.receipt(RECEIPTS[i % RECEIPTS.length]), 390, 844, 2),
  (i) => jpeg(scenes.sunset([["#1e3a8a", "#f97316", "#fcd34d", "#1e40af", 300], ["#4c1d95", "#ec4899", "#fdba74", "#312e81", 220]][i % 2]), 900, 900),
];

for (let i = 0; i < COUNT; i++) {
  const buf = await MAKERS[i % MAKERS.length](Math.floor(i / MAKERS.length));
  fs.writeFileSync(path.join(OUT, `IMG_${5000 + i}.jpg`), buf);
}
await browser.close();
console.log(`${COUNT} demo photos in ${OUT}`);
