// Builds the App Store screenshots from the real app filled with a demo library.
// Usage: start the app (npx vite --port 5199), then: node branding/store/make-screenshots.mjs http://localhost:5199
// Needs Playwright (npm i -g playwright). Output: branding/store/out/
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { items, palettes, backdrops, scenes } from "./products.mjs";
import * as biz from "./business.mjs";
import { SHOTS } from "./captions.mjs";

const APP = process.argv[2] ?? "http://localhost:5199";
const OUT = path.join(import.meta.dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function jpeg(html, w, h, scale = 1) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await p.setContent(html.startsWith("<svg") ? `<body style="margin:0">${html.replace("<svg ", `<svg width="${w}" height="${h}" `)}</body>` : html);
  const buf = await p.screenshot({ type: "jpeg", quality: 85 });
  await p.close();
  return buf.toString("base64");
}

// ---- Demo library -------------------------------------------------------------------------
const MB = 1024 * 1024;
const product = (fn) => (i) => jpeg(fn(palettes[i % 8], backdrops[(i * 3 + 1) % 8]), 600, 600);
const LIB = [
  // section, name, seeded, count, avg MB, image maker, labels
  ["products", "Bags", true, 214, 3.4, (i) => jpeg(items[i % 2 ? "crossbody" : "tote"](palettes[i % 8], backdrops[(i * 3 + 1) % 8]), 600, 600), "handbag"],
  ["products", "Sneakers", false, 168, 3.1, product(items.sneaker), "sneaker"],
  ["products", "Shirts", true, 122, 2.6, product(items.shirt), "t-shirt"],
  ["products", "Hats", true, 97, 2.9, product(items.cap), "baseball cap"],
  ["products", "Beanies", true, 64, 2.7, product(items.beanie), "beanie"],
  ["products", "Sunglasses", false, 52, 2.4, product(items.sunglasses), "sunglasses"],
  ["products", "Fragrance", true, 41, 2.8, product(items.fragrance), "fragrance bottle"],
  ["products", "Wallets", true, 38, 2.5, product(items.wallet), "wallet"],
  ["products", "Socks", true, 30, 2.2, product(items.socks), "socks"],
  ["products", "Belts", true, 22, 2.6, product(items.belt), "belt"],
  ["products", "Card Holders", true, 18, 2.3, product(items.wallet), "card holder"],
  ["products", "Clothing Sets", true, 15, 3.0, product(items.shirt), "clothing set"],
  ["products", "Shorts", true, 12, 2.4, product(items.shirt), "shorts"],
  ["products", "Pants", true, 9, 2.5, product(items.shirt), "pants"],
  ["products", "Toys", true, 6, 2.6, product(items.cap), "toy"],
  ["business", "Receipts", true, 86, 0.6, (i) => jpeg(biz.receipt(RECEIPTS[i % RECEIPTS.length]), 390, 844, 1.5), "store receipt"],
  ["business", "Order Confirmations", true, 54, 0.7, (i) => jpeg(biz.order(ORDERS[i % ORDERS.length]), 390, 844, 1.5), "order confirmation"],
  ["business", "Invoices", true, 23, 0.5, (i) => jpeg(biz.invoice(INVOICES[i % INVOICES.length]), 390, 844, 1.5), "invoice"],
  ["business", "Payment Screens", true, 31, 0.5, (i) => jpeg(biz.payment(PAYMENTS[i % PAYMENTS.length]), 390, 844, 1.5), "payment sent"],
  ["personal", "Sunsets", false, 45, 3.6, (i) => jpeg(scenes.sunset(SUNSETS[i % SUNSETS.length]), 600, 600), "sunset"],
  ["personal", "Hiking", false, 60, 3.8, (i) => jpeg(scenes.mountains(HIKES[i % HIKES.length]), 600, 600), "mountain trail"],
];
const RECEIPTS = [
  { store: "Packwell Supply", date: "Oct 18, 2026", items: [["Poly mailers 100ct", 18.99], ["Bubble wrap roll", 12.49], ["Packing tape x3", 9.97]] },
  { store: "Copperleaf Market", date: "Oct 15, 2026", items: [["Garment bags", 14.0], ["Hangers 20pk", 11.5]] },
  { store: "Bluebird Thrift", date: "Oct 12, 2026", items: [["Leather tote", 24.0], ["Wool beanie", 6.0], ["Sneakers", 18.0]] },
  { store: "Ridgeway Shipping", date: "Oct 9, 2026", items: [["Priority label", 9.85], ["Box 12x10x8", 3.25]] },
  { store: "Northside Outlet", date: "Oct 3, 2026", items: [["Caps 3 for 2", 30.0], ["Sunglasses", 12.99]] },
];
const ORDERS = [
  { store: "Lumen Labels", item: "Thermal labels 500ct", price: 21.99, color: "#0f766e", date: "Oct 17" },
  { store: "Fieldhouse Goods", item: "Wholesale socks 24pk", price: 64.0, color: "#2563eb", date: "Oct 11" },
  { store: "Arcadia Studio", item: "Photo light box", price: 89.5, color: "#7c3aed", date: "Oct 6" },
];
const INVOICES = [
  { from: "Studio Nine Photo", to: "Tyler's Resale", number: "1042", date: "Oct 14, 2026", color: "#b45309", lines: [["Product photos", 40, 2.5], ["Retouching", 1, 35]] },
  { from: "Hillcrest Storage", to: "Tyler's Resale", number: "2207", date: "Oct 1, 2026", color: "#0f766e", lines: [["Unit 14B, October", 1, 95]] },
];
const PAYMENTS = [
  { to: "Ridgeway Shipping", amount: 42.6, color: "#0f766e", date: "Oct 16", note: "Shipping labels" },
  { to: "Marcus L.", amount: 120.0, color: "#2563eb", date: "Oct 10", note: "Bundle of 6 bags" },
  { to: "Hillcrest Storage", amount: 95.0, color: "#7c3aed", date: "Oct 2", note: "Storage unit" },
];
const SUNSETS = [["#1e3a8a", "#f97316", "#fcd34d", "#1e40af", 300], ["#4c1d95", "#ec4899", "#fdba74", "#312e81", 220], ["#0f172a", "#ea580c", "#fde047", "#1e3a8a", 380]];
const HIKES = [["#bae6fd", "#e0f2fe", "#64748b", "#334155", "#1e293b"], ["#fed7aa", "#fff7ed", "#78716c", "#57534e", "#292524"], ["#a7f3d0", "#ecfdf5", "#4d7c0f", "#365314", "#1a2e05"]];

const DISTINCT = 12; // distinct images per category; records cycle through them
const now = Date.UTC(2026, 9, 20);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const categories = [];
const photos = [];
const images = {}; // categoryId -> base64 jpegs
for (const [section, name, seeded, count, avg, make, label] of LIB) {
  const id = `cat-${name.toLowerCase().replace(/\W+/g, "-")}`;
  categories.push({ id, section, name, seeded, createdAt: now - 30 * 864e5 });
  images[id] = await Promise.all(Array.from({ length: Math.min(DISTINCT, count) }, (_, i) => make(i)));
  for (let i = 0; i < count; i++) {
    photos.push({
      id: `${id}-${i}`, fileName: `IMG_${4000 + photos.length}.jpg`, mimeType: "image/jpeg",
      bytes: Math.round(avg * MB * (0.7 + rand() * 0.6)), width: 3024, height: 4032,
      takenAt: now - i * 3.6e6 * 7, importedAt: now, status: "sorted", categoryId: id,
      label, confidence: 0.95, source: { kind: "file" }, img: i % images[id].length,
    });
  }
}
console.log(`demo library: ${photos.length} photos in ${categories.length} categories`);

// ---- Capture ------------------------------------------------------------------------------
// The iOS app has no "Add photos" buttons; on iPhone the top bar sits under the status bar.
const NATIVE_CSS = ".topbar .primary, .topbar .hide-small { display: none !important; }";
const PHONE_CSS = ".topbar { padding-top: 62px !important; } :root { --topbar-h: 113px !important; }";
let extraCss = "";

async function openApp(viewport, scale) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: "light" });
  await ctx.route("**/api/health", (r) => r.fulfill({ json: { ai: true, passcodeRequired: false } }));
  const page = await ctx.newPage();
  await page.goto(`${APP}/api/health`);
  await page.evaluate(async ({ categories, photos, images }) => {
    const db = await new Promise((ok, fail) => {
      const req = indexedDB.open("organizeit", 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("photos", { keyPath: "id" }).createIndex("byCategory", "categoryId");
        d.createObjectStore("blobs", { keyPath: "id" });
        d.createObjectStore("categories", { keyPath: "id" });
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    const blobs = {};
    for (const [cat, list] of Object.entries(images))
      blobs[cat] = list.map((b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
    const tx = db.transaction(["photos", "blobs", "categories"], "readwrite");
    for (const c of categories) tx.objectStore("categories").put(c);
    for (const { img, ...p } of photos) {
      tx.objectStore("photos").put(p);
      const b = blobs[p.categoryId][img];
      tx.objectStore("blobs").put({ id: p.id, original: b, thumb: b });
    }
    await new Promise((ok) => (tx.oncomplete = ok));
  }, { categories, photos, images });
  await page.goto(APP);
  await page.addStyleTag({ content: NATIVE_CSS + extraCss });
  await page.waitForSelector(".usage-list");
  return { page, ctx };
}

async function settle(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete && i.naturalWidth));
  await page.waitForTimeout(200);
}

async function openCategory(page, name, phone) {
  await page.goto(APP);
  await page.addStyleTag({ content: NATIVE_CSS + extraCss });
  if (phone) {
    await page.click(".menu-toggle");
  }
  await page.locator(".sidebar .nav-item", { hasText: new RegExp(`^${name}`) }).first().click();
  await page.waitForSelector(".grid img");
}

async function capture(device) {
  extraCss = device.phone ? PHONE_CSS : "";
  const { page, ctx } = await openApp(device.viewport, device.scale);
  const phone = device.phone;
  const raw = {};
  await settle(page);
  raw.overview = await page.screenshot();

  if (phone) {
    await page.click(".menu-toggle");
    await settle(page);
    raw.menu = await page.screenshot();
  }
  for (const name of ["Sneakers", "Receipts", "Bags"]) {
    await openCategory(page, name, phone);
    await settle(page);
    raw[name] = await page.screenshot();
  }
  // Bulk select in Bags
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const tiles = page.locator(".grid .tile");
  for (const i of [0, 1, 3, 4, 5, 7, 9]) await tiles.nth(i).click();
  await settle(page);
  raw.select = await page.screenshot();
  await ctx.close();
  return raw;
}

const STATUS_ICONS = `<svg height="1em" viewBox="0 0 64 16" style="vertical-align:middle"><g fill="#111">
<rect x="0" y="10" width="3.5" height="5" rx="1"/><rect x="5" y="7" width="3.5" height="8" rx="1"/><rect x="10" y="4" width="3.5" height="11" rx="1"/><rect x="15" y="1" width="3.5" height="14" rx="1"/>
<path d="M31 14.5l2.6-3a3.6 3.6 0 0 0-5.2 0zM26.4 9.6a6.4 6.4 0 0 1 9.2 0l1.6-1.8a8.9 8.9 0 0 0-12.4 0zM23.2 6.2a11 11 0 0 1 15.6 0l1.6-1.8a13.4 13.4 0 0 0-18.8 0z"/>
<rect x="44" y="2" width="17" height="11" rx="3" fill="none" stroke="#111" stroke-opacity=".45"/><rect x="45.8" y="3.8" width="13.4" height="7.4" rx="1.6"/><rect x="62" y="5.5" width="1.6" height="4" rx=".8" opacity=".45"/></g></svg>`;
const ICON = fs.readFileSync(path.join(import.meta.dirname, "..", "icon.svg"), "utf8");

async function compose(device, raw) {
  const [W, H] = device.out;
  for (const [i, shot] of SHOTS.filter((s) => raw[s.screen]).slice(0, 5).entries()) {
    const img = `data:image/png;base64,${raw[shot.screen].toString("base64")}`;
    const html = `<html><head><style>
body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:Inter,sans-serif;
background:radial-gradient(120% 80% at 20% 0%,#14b8a6 0%,#0f766e 45%,#134e4a 100%);color:#fff;position:relative}
.head{position:absolute;top:${device.top}px;left:0;right:0;text-align:center;padding:0 ${W * 0.08}px}
h1{font-size:${device.h1}px;line-height:1.05;margin:0;font-weight:800;letter-spacing:-.025em}
p{font-size:${device.h1 * 0.42}px;margin:${device.h1 * 0.35}px 0 0;opacity:.88;font-weight:500;line-height:1.3}
.dev{position:absolute;left:50%;transform:translateX(-50%);top:${device.devTop}px;width:${device.devW}px;
border-radius:${device.radius}px;background:#0b0f0f;padding:${device.bezel}px;box-shadow:0 40px 120px rgb(0 0 0/.45),inset 0 0 0 3px #2a3433}
.dev img{display:block;width:100%;border-radius:${device.radius - device.bezel}px}
.bar{position:absolute;left:${device.bezel}px;right:${device.bezel}px;top:${device.bezel}px;height:${device.statusH}px;display:flex;justify-content:space-between;align-items:center;padding:0 ${device.devW * 0.09}px;font-weight:600;font-size:${device.statusH * 0.3}px;color:#111}
${device.phone ? `.island{position:absolute;top:${device.bezel + device.devW * 0.025}px;left:50%;transform:translateX(-50%);width:${device.devW * 0.28}px;height:${device.devW * 0.08}px;background:#000;border-radius:999px}` : ""}
</style></head><body><div class="head"><h1>${shot.title}</h1><p>${shot.sub}</p></div>
<div class="dev"><img src="${img}"><div class="bar"><span>9:41</span><span>${STATUS_ICONS}</span></div>${device.phone ? '<div class="island"></div>' : ""}</div></body></html>`;
    const p = await browser.newPage({ viewport: { width: W, height: H } });
    await p.setContent(html, { waitUntil: "load" });
    const file = path.join(OUT, `${device.name}-${i + 1}-${shot.screen.toLowerCase()}.png`);
    await p.screenshot({ path: file });
    await p.close();
    console.log("wrote", file);
  }
}

const DEVICES = [
  // iPhone 6.9" display: 1320 x 2868
  { name: "iphone-6.9", phone: true, viewport: { width: 440, height: 956 }, scale: 3, out: [1320, 2868],
    top: 190, h1: 112, devTop: 640, devW: 1100, bezel: 26, radius: 150, statusH: 150 },
  // iPad 13" display: 2064 x 2752
  { name: "ipad-13", phone: false, viewport: { width: 1032, height: 1376 }, scale: 2, out: [2064, 2752],
    top: 170, h1: 120, devTop: 600, devW: 1760, bezel: 34, radius: 80, statusH: 0 },
];
for (const d of DEVICES) await compose(d, await capture(d));
await browser.close();
