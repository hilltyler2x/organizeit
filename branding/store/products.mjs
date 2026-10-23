// Studio-style product "photos" for the App Store screenshots: one item on a soft backdrop.
const S = 600;

function frame(bg1, bg2, body, shadowW = 360) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs>
<radialGradient id="bd" cx=".5" cy=".38" r=".85"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
<radialGradient id="sh"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="dk" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
</defs>
<rect width="${S}" height="${S}" fill="url(#bd)"/>
<ellipse cx="300" cy="500" rx="${shadowW / 2}" ry="30" fill="url(#sh)"/>
${body}
</svg>`;
}

const shade = (d, c) => `<path d="${d}" fill="${c}"/><path d="${d}" fill="url(#dk)"/><path d="${d}" fill="url(#gl)"/>`;

export const items = {
  tote: (c, bg) => frame(bg[0], bg[1], `
<path d="M215 230 C215 120 385 120 385 230" fill="none" stroke="${c.dark}" stroke-width="16" stroke-linecap="round"/>
${shade("M150 230 H450 L480 490 Q482 505 466 505 H134 Q118 505 120 490 Z", c.main)}
<path d="M150 230 H450 L454 262 H146 Z" fill="${c.dark}" opacity=".35"/>
<rect x="282" y="300" width="36" height="22" rx="4" fill="${c.metal}"/>`),
  crossbody: (c, bg) => frame(bg[0], bg[1], `
<path d="M170 300 C150 120 450 120 430 300" fill="none" stroke="${c.dark}" stroke-width="10"/>
${shade("M140 290 Q140 270 160 270 H440 Q460 270 460 290 V470 Q460 492 438 492 H162 Q140 492 140 470 Z", c.main)}
<path d="M140 290 Q140 270 160 270 H440 Q460 270 460 290 V380 Q300 410 140 380 Z" fill="${c.dark}" opacity=".55"/>
<path d="M140 290 Q140 270 160 270 H440 Q460 270 460 290 V380 Q300 410 140 380 Z" fill="url(#gl)"/>
<circle cx="300" cy="388" r="16" fill="${c.metal}"/><circle cx="300" cy="388" r="7" fill="${c.dark}" opacity=".5"/>`),
  sneaker: (c, bg) => frame(bg[0], bg[1], `
${shade("M92 424 C88 384 116 362 168 352 L246 334 C276 312 296 282 318 252 L432 240 C474 238 494 262 498 300 L502 424 Z", c.main)}
<path d="M92 424 C88 384 116 362 168 352 L200 345 C190 380 180 404 176 424 Z" fill="${c.dark}" opacity=".18"/>
<path d="M430 240 C474 238 494 262 498 300 L502 424 H452 C452 360 446 290 430 240 Z" fill="${c.dark}" opacity=".22"/>
<path d="M86 420 H508 Q514 460 488 464 H112 Q82 464 86 420 Z" fill="${c.sole}"/>
<path d="M86 438 H510" stroke="#000" stroke-opacity=".1" stroke-width="5"/>
<path d="M200 404 C270 396 350 360 446 316 C430 352 380 400 300 414 C260 420 220 418 200 404 Z" fill="${c.accent}"/>
<g stroke="${c.dark}" stroke-width="7" stroke-linecap="round" opacity=".75"><line x1="300" y1="290" x2="330" y2="300"/><line x1="282" y1="312" x2="312" y2="322"/><line x1="262" y1="332" x2="292" y2="342"/></g>
<path d="M318 252 C340 240 380 236 432 240" fill="none" stroke="${c.dark}" stroke-width="10" stroke-linecap="round" opacity=".5"/>`, 440),
  cap: (c, bg) => frame(bg[0], bg[1], `
${shade("M150 400 C140 250 240 190 320 192 C410 194 470 260 470 400 Z", c.main)}
<path d="M140 396 H480 C520 398 560 420 556 438 C552 452 520 450 470 440 C380 424 250 424 140 432 Z" fill="${c.dark}"/>
<path d="M310 194 C300 260 300 330 310 400" fill="none" stroke="${c.dark}" stroke-width="4" opacity=".4"/>
<circle cx="316" cy="194" r="12" fill="${c.dark}"/>
<rect x="210" y="300" width="80" height="44" rx="8" fill="${c.accent}"/>`, 400),
  beanie: (c, bg) => frame(bg[0], bg[1], `
<circle cx="300" cy="148" r="46" fill="${c.accent}"/><circle cx="300" cy="148" r="46" fill="url(#gl)"/>
${shade("M160 380 C150 230 220 180 300 180 C380 180 450 230 440 380 Z", c.main)}
${shade("M150 360 H450 Q462 360 462 374 V452 Q462 466 450 466 H150 Q138 466 138 452 V374 Q138 360 150 360 Z", c.dark)}
<g stroke="#000" stroke-opacity=".12" stroke-width="5">${Array.from({ length: 13 }, (_, i) => `<line x1="${165 + i * 22.5}" y1="368" x2="${165 + i * 22.5}" y2="458"/>`).join("")}</g>`, 380),
  sunglasses: (c, bg) => frame(bg[0], bg[1], `
<path d="M90 250 L60 222 M510 250 L540 222" stroke="${c.metal}" stroke-width="10" stroke-linecap="round"/>
<path d="M95 250 H505" stroke="${c.metal}" stroke-width="10"/>
<path d="M262 262 Q300 240 338 262" fill="none" stroke="${c.metal}" stroke-width="9"/>
<path d="M100 252 C96 360 160 400 210 396 C262 392 270 330 262 262 Z" fill="${c.main}" stroke="${c.metal}" stroke-width="8"/>
<path d="M500 252 C504 360 440 400 390 396 C338 392 330 330 338 262 Z" fill="${c.main}" stroke="${c.metal}" stroke-width="8"/>
<path d="M110 262 C112 300 130 330 150 344 L200 270 Z" fill="#fff" opacity=".25"/>
<path d="M348 262 C350 300 368 330 388 344 L438 270 Z" fill="#fff" opacity=".25"/>`, 380),
  fragrance: (c, bg) => frame(bg[0], bg[1], `
<rect x="262" y="120" width="76" height="70" rx="10" fill="${c.dark}"/><rect x="262" y="120" width="76" height="70" rx="10" fill="url(#gl)"/>
<rect x="282" y="186" width="36" height="26" fill="${c.metal}"/>
<rect x="180" y="208" width="240" height="290" rx="34" fill="${c.main}" opacity=".9"/>
<rect x="196" y="250" width="208" height="234" rx="24" fill="${c.accent}" opacity=".55"/>
<rect x="180" y="208" width="240" height="290" rx="34" fill="url(#gl)"/>
<rect x="240" y="320" width="120" height="56" rx="6" fill="#fff" opacity=".85"/>
<rect x="258" y="338" width="84" height="8" rx="4" fill="${c.dark}" opacity=".6"/><rect x="272" y="354" width="56" height="6" rx="3" fill="${c.dark}" opacity=".35"/>`, 280),
  wallet: (c, bg) => frame(bg[0], bg[1], `
${shade("M130 230 Q130 210 150 210 H450 Q470 210 470 230 V460 Q470 480 450 480 H150 Q130 480 130 460 Z", c.main)}
<path d="M130 230 Q130 210 150 210 H450 Q470 210 470 230 V320 H130 Z" fill="${c.dark}" opacity=".4"/>
<rect x="146" y="226" width="308" height="238" rx="10" fill="none" stroke="${c.accent}" stroke-width="3" stroke-dasharray="10 8" opacity=".8"/>
<rect x="410" y="300" width="60" height="44" rx="8" fill="${c.dark}"/><circle cx="440" cy="322" r="9" fill="${c.metal}"/>`, 380),
  belt: (c, bg) => frame(bg[0], bg[1], `
<circle cx="300" cy="330" r="150" fill="none" stroke="${c.main}" stroke-width="56"/>
<circle cx="300" cy="330" r="150" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="56" stroke-dasharray="4 900"/>
<circle cx="300" cy="330" r="96" fill="none" stroke="${c.dark}" stroke-width="44"/>
<circle cx="300" cy="330" r="172" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/>
<rect x="390" y="300" width="110" height="70" rx="14" fill="none" stroke="${c.metal}" stroke-width="14"/>
<line x1="420" y1="335" x2="490" y2="335" stroke="${c.metal}" stroke-width="10" stroke-linecap="round"/>`, 380),
  shirt: (c, bg) => frame(bg[0], bg[1], `
${shade("M230 140 Q300 180 370 140 L480 190 L450 280 L410 262 V480 Q410 492 398 492 H202 Q190 492 190 480 V262 L150 280 L120 190 Z", c.main)}
<path d="M230 140 Q300 200 370 140" fill="none" stroke="${c.dark}" stroke-width="12"/>
<rect x="250" y="270" width="100" height="70" rx="8" fill="${c.accent}"/>`, 360),
  socks: (c, bg) => frame(bg[0], bg[1], `
<g transform="rotate(-8 300 300)">
${shade("M190 130 H290 V360 Q290 420 240 450 L170 492 Q130 510 112 474 Q98 446 130 424 L190 384 Z", c.main)}
<rect x="190" y="130" width="100" height="40" fill="${c.dark}"/><rect x="190" y="200" width="100" height="16" fill="${c.accent}"/></g>
<g transform="rotate(8 300 300)">
${shade("M320 130 H420 V360 Q420 420 370 450 L300 492 Q260 510 242 474 Q228 446 260 424 L320 384 Z", c.main)}
<rect x="320" y="130" width="100" height="40" fill="${c.dark}"/><rect x="320" y="200" width="100" height="16" fill="${c.accent}"/></g>`, 400),
};

export const scenes = {
  sunset: (h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h[0]}"/><stop offset=".6" stop-color="${h[1]}"/><stop offset="1" stop-color="${h[2]}"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h[3]}"/><stop offset="1" stop-color="#0b1b33"/></linearGradient></defs>
<rect width="${S}" height="${S}" fill="url(#sky)"/>
<circle cx="${h[4]}" cy="372" r="70" fill="#fff4d6" opacity=".95"/>
<rect y="380" width="${S}" height="220" fill="url(#sea)"/>
<g fill="#fff4d6" opacity=".55">${[400, 420, 444, 472].map((y, i) => `<rect x="${h[4] - 60 + i * 12}" y="${y}" width="${120 - i * 24}" height="5" rx="2.5"/>`).join("")}</g>
<path d="M0 520 C120 490 200 540 320 520 C420 504 520 530 600 512 V600 H0 Z" fill="#081426" opacity=".6"/></svg>`,
  mountains: (h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h[0]}"/><stop offset="1" stop-color="${h[1]}"/></linearGradient></defs>
<rect width="${S}" height="${S}" fill="url(#sky)"/>
<path d="M0 380 L140 220 L230 310 L330 170 L470 330 L600 240 V600 H0 Z" fill="${h[2]}"/>
<path d="M330 170 L370 216 L350 226 L330 212 L306 230 L296 210 Z" fill="#fff" opacity=".85"/>
<path d="M0 450 L120 360 L260 440 L400 350 L600 460 V600 H0 Z" fill="${h[3]}"/>
<path d="M0 520 C150 490 300 540 600 500 V600 H0 Z" fill="${h[4]}"/></svg>`,
};

// Colorways reused across items.
export const palettes = [
  { main: "#c08552", dark: "#7a4a24", accent: "#f2d7b6", metal: "#d4af37", sole: "#f5f1ea" },
  { main: "#1f2937", dark: "#0b0f17", accent: "#ef4444", metal: "#cbd5e1", sole: "#f8fafc" },
  { main: "#f9fafb", dark: "#94a3b8", accent: "#0f766e", metal: "#a3a3a3", sole: "#e5e7eb" },
  { main: "#e879a6", dark: "#9d174d", accent: "#fde68a", metal: "#e5c07b", sole: "#fff1f2" },
  { main: "#2563eb", dark: "#1e3a8a", accent: "#fbbf24", metal: "#e5e7eb", sole: "#f1f5f9" },
  { main: "#65a30d", dark: "#365314", accent: "#fef08a", metal: "#d6d3d1", sole: "#fafaf9" },
  { main: "#f59e0b", dark: "#92400e", accent: "#1f2937", metal: "#fef3c7", sole: "#fffbeb" },
  { main: "#7c3aed", dark: "#4c1d95", accent: "#a7f3d0", metal: "#e9d5ff", sole: "#f5f3ff" },
];
export const backdrops = [
  ["#ffffff", "#e7e5e4"], ["#f8fafc", "#cbd5e1"], ["#fff7ed", "#fed7aa"], ["#f0fdfa", "#99f6e4"],
  ["#fdf2f8", "#fbcfe8"], ["#f5f5f4", "#d6d3d1"], ["#eff6ff", "#bfdbfe"], ["#fefce8", "#fde68a"],
];
