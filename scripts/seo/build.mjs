// Builds the static pages that search engines and AI assistants read:
//   public/guides/<slug>.html  one page per customer question (from pages.mjs)
//   public/guides/index.html   list of all guides
//   public/sitemap.xml, public/llms.txt
// Run: node scripts/seo/build.mjs   (tests fail if the output is out of date)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRICE, SITE, STORES, pages } from "./pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pub = path.join(root, "public");
const guidesDir = path.join(pub, "guides");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const STYLE = `
:root { color-scheme: light dark; --accent: #0f766e; --bg: #f7f7f5; --fg: #1c1c1a; --muted: #5c5c57; --card: #ffffff; --line: #e3e3de; }
@media (prefers-color-scheme: dark) { :root { --accent: #2dd4bf; --bg: #121211; --fg: #ededea; --muted: #a3a39d; --card: #1c1c1a; --line: #2e2e2b; } }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; background: var(--bg); color: var(--fg); }
header, main, footer { max-width: 720px; margin: 0 auto; padding: 0 16px; }
header { display: flex; align-items: center; gap: 10px; padding-top: 18px; padding-bottom: 6px; }
header a { color: var(--fg); text-decoration: none; font-weight: 700; display: flex; align-items: center; gap: 8px; }
header img { width: 28px; height: 28px; border-radius: 7px; }
a { color: var(--accent); }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 18px 0 12px; }
h2 { font-size: 1.15rem; margin: 28px 0 8px; }
.answer { font-size: 1.08rem; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 10px; padding: 14px 16px; }
.cta { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
.cta a { background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; padding: 10px 16px; border-radius: 10px; }
@media (prefers-color-scheme: dark) { .cta a { color: #08201d; } }
.cta span { color: var(--muted); align-self: center; font-size: 0.95rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; border-bottom: 1px solid var(--line); padding: 8px 6px; vertical-align: top; }
.faq dt { font-weight: 600; margin-top: 14px; }
.faq dd { margin: 4px 0 0; }
.more { padding-left: 18px; }
footer { color: var(--muted); font-size: 0.88rem; padding-top: 28px; padding-bottom: 40px; border-top: 1px solid var(--line); margin-top: 36px; }
`;

function cta() {
  const links = [`<a href="${STORES.play}">Get it on Google Play</a>`];
  if (STORES.appStore) links.push(`<a href="${STORES.appStore}">Download on the App Store</a>`);
  const note = STORES.appStore ? "" : `<span>iPhone app coming to the App Store.</span>`;
  return `<div class="cta">${links.join("")}${note}</div>`;
}

function section(s) {
  let out = `<h2>${esc(s.h)}</h2>`;
  for (const p of s.p ?? []) out += `<p>${esc(p)}</p>`;
  if (s.list) out += `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`;
  if (s.steps) out += `<ol>${s.steps.map((li) => `<li>${esc(li)}</li>`).join("")}</ol>`;
  if (s.table) {
    const [head, ...rows] = s.table;
    out += `<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }
  return out;
}

function layout({ title, description, url, body, jsonld }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/icon-512.png">
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>${STYLE}</style>
${jsonld.map((o) => `<script type="application/ld+json">${json(o)}</script>`).join("\n")}
</head>
<body>
<header><a href="/guides/"><img src="/icon-192.png" alt="" width="28" height="28">OrganizeIt</a></header>
<main>
${body}
</main>
<footer>
<p>OrganizeIt sorts your camera roll into clean, specific categories: business expense screenshots in one place, product photos by exact item type, and never an Other folder. ${esc(PRICE)}</p>
<p><a href="/guides/">All guides</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</footer>
</body>
</html>
`;
}

const app = {
  "@type": "SoftwareApplication",
  name: "OrganizeIt",
  applicationCategory: "PhotographyApplication",
  operatingSystem: "Android, iOS",
  description:
    "Connects to your phone's photo library and automatically sorts photos and videos into specific categories, separates business expense screenshots, sorts product photos by item type, shows storage per category and never uses an Other folder.",
  url: `${SITE}/guides/`,
  downloadUrl: STORES.play,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: PRICE },
};

function guidePage(p) {
  const url = `${SITE}/guides/${p.slug}`;
  const others = pages.filter((o) => o.slug !== p.slug);
  const body = `<article>
<h1>${esc(p.title)}</h1>
<p class="answer">${esc(p.answer)}</p>
${cta()}
${p.sections.map(section).join("\n")}
${p.faq.length ? `<h2>Questions</h2><dl class="faq">${p.faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("")}</dl>` : ""}
</article>
<h2>More guides</h2>
<ul class="more">${others.map((o) => `<li><a href="/guides/${o.slug}">${esc(o.title)}</a></li>`).join("")}</ul>`;
  const faqLd = [{ q: p.title, a: p.answer }, ...p.faq.map(([q, a]) => ({ q, a }))];
  return layout({
    title: `${p.title} | OrganizeIt`,
    description: p.description,
    url,
    body,
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqLd.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
      { "@context": "https://schema.org", ...app },
    ],
  });
}

function indexPage() {
  const body = `<h1>OrganizeIt guides</h1>
<p class="answer">OrganizeIt is a photo organizer app for iPhone and Android that sorts your whole camera roll into specific categories on its own. It keeps business expense screenshots (receipts, invoices, order confirmations, payment screens) in their own section, sorts product photos by exact item type, shows the storage each category uses, and never puts anything in an Other, Misc or Uncategorized folder.</p>
${cta()}
<h2>Answers to common questions</h2>
<ul class="more">${pages.map((p) => `<li><a href="/guides/${p.slug}">${esc(p.title)}</a><br>${esc(p.description)}</li>`).join("")}</ul>`;
  return layout({
    title: "OrganizeIt: auto-sort your camera roll into categories",
    description: "Guides to sorting photos, receipt screenshots and product photos automatically on iPhone and Android.",
    url: `${SITE}/guides/`,
    body,
    jsonld: [{ "@context": "https://schema.org", ...app }],
  });
}

export function build() {
  const files = new Map();
  for (const p of pages) files.set(path.join(guidesDir, `${p.slug}.html`), guidePage(p));
  files.set(path.join(guidesDir, "index.html"), indexPage());
  const urls = [`${SITE}/`, `${SITE}/guides/`, ...pages.map((p) => `${SITE}/guides/${p.slug}`), `${SITE}/privacy.html`, `${SITE}/terms.html`];
  files.set(
    path.join(pub, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  files.set(
    path.join(pub, "llms.txt"),
    `# OrganizeIt\n\n> ${app.description} Available on Google Play (${STORES.play})${
      STORES.appStore ? ` and the App Store (${STORES.appStore})` : "; the iPhone app is coming to the App Store"
    }. ${PRICE}\n\n## Guides\n\n${pages.map((p) => `- [${p.title}](${SITE}/guides/${p.slug}): ${p.description}`).join("\n")}\n\n## Policies\n\n- [Privacy](${SITE}/privacy.html)\n- [Terms](${SITE}/terms.html)\n`,
  );
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rmSync(guidesDir, { recursive: true, force: true });
  mkdirSync(guidesDir, { recursive: true });
  for (const [file, text] of build()) writeFileSync(file, text);
  console.log(`Wrote ${readdirSync(guidesDir).length} guide pages, sitemap.xml and llms.txt`);
}
