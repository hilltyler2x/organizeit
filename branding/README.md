# Branding

- `icon.svg` is the app icon (1024×1024, full bleed). `options/` holds the other directions that were considered.
- `node branding/make-icons.mjs` renders every icon and splash screen from `icon.svg`: the iOS app icon and splash, the Android launcher icons (legacy, round and adaptive layers) and splash screens, and the web icons in `public/`.
- `branding/store/` builds the App Store screenshots from the real app filled with a made-up demo library:
  1. `npx vite --port 5199`
  2. `node branding/store/make-screenshots.mjs http://localhost:5199`
  3. Upload `branding/store/out/` to App Store Connect: `iphone-6.9-*` (1320×2868) and `ipad-13-*` (2064×2752).
  Headlines live in `branding/store/captions.mjs`.
  4. Google Play: `android-phone-*` (1080×1920) are the phone screenshots, `play-feature-graphic.png` (1024×500) and `play-icon-512.png` the listing graphics. Pass a set name as a second argument to build just one set, e.g. `android-phone`.

Both scripts need Playwright (`npm i --no-save playwright`) and ImageMagick (`convert`).

## Android background-sorting demo video

Google Play's foreground service (dataSync) declaration needs a video of background sorting.
Run **Actions > Android demo video**: it makes a demo camera roll (`store/demo-photos.mjs`),
sorts it on an emulator and records the screen (`store/record-android-demo.sh`). The video is in
the run's `android-demo-video` artifact.
