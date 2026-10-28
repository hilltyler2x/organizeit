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

The passcode keeps strangers from using your Anthropic credits, and each subscriber (or IP,
without one) is capped at `SORTS_PER_HOUR` photos per hour (default 10,000). On the free plan
the server sleeps after 15 minutes idle, so the first sort after a break takes about a minute
to start; for paying customers use a paid instance (Starter or above), which stays awake.

Sorting runs in two passes to keep the AI bill down: every photo goes to `CLASSIFY_MODEL`
(default `claude-haiku-5-5`, fast and cheap), and only photos it is less than
`CLASSIFY_ESCALATE_BELOW` sure about (default 0.75) or can't place are asked again of
`CLASSIFY_ESCALATE_MODEL` (default `claude-opus-5-5`). `CLASSIFY_ESCALATE_MODEL=none` turns
the second pass off.

### Subscriptions

The phone app sells a monthly subscription through the App Store and Google Play, with a
discounted first month, via [RevenueCat](https://www.revenuecat.com). Each phone gets
`FREE_SORT_LIMIT` photos sorted free first (default 100), the discounted month sorts up to
`INTRO_SORT_LIMIT` photos (default 2,000; the rest wait for the first full-price month), and
full-price months sort up to `MONTHLY_SORT_LIMIT` (default 0, no limit).

- Server: `REVENUECAT_SECRET_KEY` (RevenueCat → Project settings → API keys → secret key)
  turns subscriptions on. `DATABASE_URL` (any Postgres, e.g. a Render Postgres database)
  keeps the photo counts through restarts; without it they live in memory.
  `REVENUECAT_ENTITLEMENT` is the entitlement id (default `organizeit_pro`).
- App builds: `VITE_REVENUECAT_IOS_KEY` and `VITE_REVENUECAT_ANDROID_KEY` in `.env.app`
  (RevenueCat's public app-specific keys, safe to ship) let the app show the store's
  purchase sheet.
- Each phone is known by an id that survives reinstalling the app (a keychain entry on
  iPhone, `ANDROID_ID` on Android), which is also its RevenueCat user id. "Restore purchases"
  moves a subscription to a new phone.
- The passcode still sorts without a subscription (the website, and the owner via
  "Have a passcode?" on the subscribe screen). After 10 wrong passcodes in an hour an address
  is shut out for the rest of the hour. Each passcode belongs to the first phone that unlocks
  with it and works nowhere else (the claim is kept, hashed, in the `passcode_owners` table).
  For another phone, add another passcode to `APP_PASSCODE`, comma-separated.

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

Photos waiting to be sorted are shown in a "Sorting…" panel. The AI files nearly everything
itself: close calls get a second opinion from the stronger model and are then filed under the
best answer (or a new specific category). Only photos it can't make out at all (below 30%), or
that fail to sort, go to **To review** instead of being filed. There
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

- **While the app is open (or still running):** a new photo is noticed the moment it lands
  in the library (PhotoKit change observer / Android ContentObserver) and sorted right away.
- **iPhone, iOS 26 or later:** when photos are waiting, a continued processing task starts
  while the app is open. Close the app and sorting carries on, with progress shown by iOS,
  which can be stopped from there. While the app is open it sorts by itself and the task only
  follows along. Once everything is sorted it keeps watching for new photos for 5 more
  minutes before ending (only while charging).
- **Any iPhone:** in the 30 seconds or so iOS gives a closed app, the waiting photos (up to
  100 on battery, 200 while charging) are prepared and handed to iOS's background transfer
  service (`BackgroundUploads.swift`). iOS keeps sending them to `/api/classify` while the app
  is suspended, then wakes it briefly to keep the answers and, while charging, hand over the
  next 200. Opening the app takes back whatever is still waiting. Plus background refresh
  and processing tasks that iOS runs when it chooses (often overnight while charging) to sort
  photos taken since. iOS never runs an app the moment a photo is taken, and runs nothing for
  an app that was swiped away in the app switcher until it is opened again. Background App
  Refresh must be on for OrganizeIt in Settings.
- **Android:** a "Sorting photos" notification (a foreground service) keeps sorting after
  the app is closed; new photos are sorted a few seconds after they are added, and hourly
  as a fallback (Android may delay these to save battery).

- **Saving battery (both phones):** on battery, a background run sorts at most 100 photos,
  gives up on an unreachable server after 3 minutes (15 while charging), and on iPhone
  doesn't download photos kept only in iCloud. In Low Power Mode / Battery Saver, or under
  20% and not plugged in, it doesn't sort at all. The big catch-up (iOS processing task,
  Android hourly job) only runs while charging, the iOS refresh asks for about one wake-up an
  hour, and the 5-minute watch after finishing only happens while charging. Opening the app
  always sorts everything, as before.

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

The app sorts the whole library. For a test build that only sorts the newest photos, add
`VITE_SORT_LIMIT=500` (or any number) to `.env.app`.

## Limits of the web version

- A website can't read the whole Photos library or delete originals from it. You choose
  which photos to add, and Delete removes them from OrganizeIt only. The phone app
  removes both limits.
- HEIC files open in Safari; other browsers skip them. iPhones normally convert to JPEG when
  sharing to the web picker.
