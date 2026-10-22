# OrganizeIt

Sorts a camera roll into clean, specific categories. Business expense screenshots (receipts,
order confirmations, invoices, payment screens) go into their own section, and reselling
product photos are sorted by exact item type, with storage shown per category.

**Core rule:** there is never an Other, Misc or Uncategorized category. Every photo is filed
under a real, specific category, and new categories are created as needed (Sneakers,
Sunglasses, Phone Cases…). The rule is enforced in one place, `src/core/categories.ts`, and
checked again on the server and in the UI.

## Run it

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm run dev                 # web app on http://localhost:5173, API on :8787
```

Production: `npm run build && npm start` serves the built site and the API from one Node
process on `PORT` (default 8787).

`npm test` runs the unit and API tests (no API key needed; the AI is faked).

## How it works

1. **Add photos.** The browser photo picker opens the Photos library on iPhone and Android
   (multi-select), or pick files / a whole folder on a computer, or drag and drop.
   Originals stay on the device in IndexedDB.
2. **Sort.** Each photo is shrunk to a ~1024px JPEG and sent to `POST /api/classify`. The
   server asks Claude (`claude-opus-5-5`, low effort, JSON output) to choose a section
   (business, products, personal) and either reuse an existing category or name a new
   specific one. If the answer is a catch-all, the server asks once more, then falls back to
   a name built from the item description, and otherwise reports an error. It never files a
   photo under a catch-all.
3. **Match.** `resolveCategory` matches the name against existing categories, ignoring case,
   plurals and common synonyms (Tees → Shirts, Cologne → Fragrance, Caps → Hats), so the
   list doesn't fill with near-duplicates.
4. **Review.** Storage per category (largest first), photo grids, select all, bulk move
   (to any category or a new one), bulk delete, rename or merge categories. Categories the AI
   created are removed automatically once they're empty; the starting ones stay.

Photos waiting to be sorted, or that failed, are shown in a "Sorting…" panel with Retry and
"Choose category" buttons. That panel is a to-do list, not a category.

## Layout

```
src/core/     Platform-neutral logic: categories + the core rule, library operations,
              storage totals. No DOM, no network. Reusable as-is in a native app.
src/lib/      Web adapters: IndexedDB storage, photo picker, image resizing, API client.
src/ui/       React UI (mobile-first, works as an installable PWA).
server/       Express API that holds the Anthropic key and calls Claude.
tests/        Vitest tests for the core rule, library operations and the API.
```

## Going to iOS / Android

The app is built so the native apps reuse this code rather than rebuilding it:

- **Wrap with Capacitor.** `capacitor.config.json` is already set up (`webDir: dist`).
  `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, then
  `npx cap add ios`, `npx cap add android`, `npm run build && npx cap sync`.
- **Point at the deployed API.** Set `VITE_API_URL` at build time. The API key stays on the
  server, never in the app.
- **Full photo library access.** Add a native `PhotoSource` in `src/lib/photoSource.ts`
  backed by a Capacitor photo library plugin. That gives whole-library scanning and lets
  Delete remove the original from the phone (`canDeleteOriginals: true`). Nothing in
  `src/core` or `src/ui` needs to change.

## Limits of the web version

- A website can't read the whole Photos library in the background or delete originals from
  it. You choose which photos to add, and Delete removes them from OrganizeIt only. The
  native build removes both limits.
- HEIC files open in Safari; other browsers skip them. iPhones normally convert to JPEG when
  sharing to the web picker.
