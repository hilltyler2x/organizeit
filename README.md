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

## Put it online (Render)

`render.yaml` sets everything up on [Render](https://render.com) (free plan):

1. Sign in to Render with GitHub, then **New → Blueprint** and pick this repo.
2. Fill in the two secrets it asks for: `ANTHROPIC_API_KEY` (from
   console.anthropic.com) and `APP_PASSCODE` (any passcode you choose).
3. Deploy. Open the `…onrender.com` address on your phone, enter the passcode once, and use
   Share → **Add to Home Screen** to get an app icon.

The passcode keeps strangers from using your Anthropic credits, and each IP is capped at
`SORTS_PER_HOUR` photos per hour (default 10,000). `CLASSIFY_MODEL` picks the Claude model
(default `claude-opus-5-5`); `claude-haiku-5-5` is much faster and cheaper, at some cost in
accuracy. On the free plan the server sleeps after
15 minutes idle, so the first sort after a break takes about a minute to start.

`npm test` runs the unit and API tests (no API key needed; the AI is faked).

## How it works

1. **Add photos.** The browser photo picker opens the Photos library on iPhone and Android
   (multi-select), or pick files / a whole folder on a computer, or drag and drop.
   Originals stay on the device in IndexedDB.
2. **Sort.** Each photo is shrunk to a ~768px JPEG. The app sends them six at a time to
   `POST /api/classify-batch`, with four requests in flight, so one AI call sorts several
   photos (the phone's background sorter uses the one-photo `POST /api/classify`). The
   server asks Claude (`claude-opus-5-5`, low effort, JSON output) to choose a section
   (business, products, personal) and either reuse an existing category or name a new
   specific one. If the answer is a catch-all, the server asks once more, then falls back to
   a name built from the item description, and otherwise reports an error. It never files a
   photo under a catch-all. In a batch, a photo the answer misses or files under a catch-all
   gets its own request with the same retry.
3. **Match.** `resolveCategory` matches the name against existing categories, ignoring case,
   plurals and common synonyms (Tees → Shirts, Cologne → Fragrance, Caps → Hats), so the
   list doesn't fill with near-duplicates.
4. **Review.** Storage per category (largest first), photo grids, select all, bulk move
   (to any category or a new one), bulk delete, rename or merge categories. Categories the AI
   created are removed automatically once they're empty; the starting ones stay.

Photos waiting to be sorted are shown in a "Sorting…" panel. When the AI isn't confident
(below 60%), or sorting fails, the photo goes to **To review** instead of being filed. There
you tap one photo to pick its category (the AI's guess is a one-tap answer), or select
several and send them to the same place, existing or new. To review is a to-do list, not a
category: every photo leaves it by being filed into a real, specific category.

**Learning.** Each time you file a photo the AI was unsure about, or move one it filed, the
AI's description of it and the category you chose are saved on the device
(`src/core/lessons.ts`). The newest 60 are sent with every sort as examples ("black slides →
Sandals, not Sneakers"), so the AI gets better at telling your categories apart.

## Layout

```
src/core/     Platform-neutral logic: categories + the core rule, library operations,
              storage totals. No DOM, no network. Reusable as-is in a native app.
src/lib/      Web adapters: IndexedDB storage, photo picker, image resizing, API client.
src/ui/       React UI (mobile-first, works as an installable PWA).
server/       Express API that holds the Anthropic key and calls Claude.
tests/        Vitest tests for the core rule, library operations and the API.
```

## Phone app (iOS / Android)

The phone app is the same code wrapped with Capacitor (`ios/`, `android/`), plus a small
native plugin in `native/photo-library` (iOS PhotoKit, Android MediaStore). The app:

- asks for Photos permission, then reads the whole library in place (nothing is copied;
  only a cached thumbnail per photo),
- sorts new photos automatically every time it is opened, newest first,
- keeps sorting after it is closed, as far as the phone allows (see below),
- deletes for real: bulk delete removes photos from the phone after the system's own
  confirmation, and photos deleted elsewhere drop out of OrganizeIt.

### Sorting while the app is closed

The web view stops when the app is closed, so the native plugin has its own sorter
(`BackgroundSorter.swift`, `BackgroundSorter.java`). Whenever the queue, categories or
lessons change, the app hands it a snapshot (`src/lib/backgroundSort.ts`): server address,
passcode, categories, the newest 60 lessons, which photos are waiting, and the newest photo it
knows about. The sorter sends those photos, then any newer ones, to `/api/classify` and keeps
the answers in a small file. Next time the app opens it reads the library, then files those
answers through the same rules as its own queue (`src/core/background.ts`), so photos the AI
was unsure about still go to To review and the core rule still holds.

- **iPhone, iOS 26 or later:** when photos are waiting, a continued processing task starts
  while the app is open. Close the app and sorting carries on, with progress shown by iOS,
  which can be stopped from there. While the app is open it sorts by itself and the task only
  follows along.
- **Any iPhone:** about 30 seconds of extra time right after closing, plus background refresh
  and processing tasks that iOS runs when it chooses (often overnight while charging) to sort
  photos taken since. iOS never runs an app the moment a photo is taken, and runs nothing for
  an app that was swiped away in the app switcher until it is opened again. Background App
  Refresh must be on for OrganizeIt in Settings.
- **Android:** a "Sorting photos" notification (a foreground service) keeps sorting after
  the app is closed; new photos are sorted about 30 seconds after they are added, and hourly
  as a fallback (Android may delay these to save battery).

`npm run build:app` builds the web code against the API in `.env.app` and syncs it into
both native projects.

### Test on your phone

- **Android (free):** every push to `main` builds a test APK and publishes it at
  `https://github.com/hilltyler2x/organizeit/releases/download/test-build/OrganizeIt-test.apk`.
  Open that link on the phone, download, and install (allow installs from your browser when
  Android asks). Each build is signed with a fresh debug key, so uninstall the old one
  before installing a newer build.
- **iPhone with a Mac (free):** install Xcode, then `npm ci && npm run build:app` and open
  `ios/App/App.xcodeproj`. Under Signing & Capabilities choose your Apple ID as the Team and
  change the bundle identifier to something unique. Plug in the iPhone, pick it as the
  run destination and press Run. Free builds expire after 7 days; run again to renew.
- **iPhone from Windows (free):** every push to `main` also publishes an unsigned
  `OrganizeIt-test.ipa` on the same `test-build` release. Install
  [Sideloadly](https://sideloadly.io) on the PC (plus iTunes from Apple's website, not the
  Microsoft Store), plug in the iPhone, drag the .ipa into Sideloadly, enter your Apple ID
  and press Start. Turn on Settings → Privacy & Security → Developer Mode on the iPhone, then
  trust your Apple ID under Settings → General → VPN & Device Management. Builds expire
  after 7 days; repeat to renew.
- **TestFlight (Apple Developer account):** the `testflight` job archives the app with
  Apple's cloud-managed signing and uploads it to App Store Connect on every push to `main`
  (or when run by hand from the Actions tab). It needs these repository secrets:
  `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the contents of an App
  Store Connect API key with Admin access). The bundle ID `com.hilltyler.organizeit` must be
  registered and have an app record in App Store Connect. Builds appear in the TestFlight
  app for internal testers after Apple finishes processing (usually 10 to 30 minutes).

`.env.app` sets `VITE_SORT_LIMIT` so test builds only sort the newest photos (remove it to
sort the whole library).

## Limits of the web version

- A website can't read the whole Photos library or delete originals from it. You choose
  which photos to add, and Delete removes them from OrganizeIt only. The phone app
  removes both limits.
- HEIC files open in Safari; other browsers skip them. iPhones normally convert to JPEG when
  sharing to the web picker.
