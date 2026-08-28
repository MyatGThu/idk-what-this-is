# Browser support

Grocery Discount Hunter is a Manifest V3 WebExtension built from one source
tree into two outputs: `dist/chrome` (Chromium manifest) and `dist/firefox`
(Gecko manifest). Build both with `npm run build` (see `build/build.js`).

"All known browsers" in practice means the three engines below — every
mainstream browser is Chromium-, Gecko- or WebKit-based, and **anything
Chromium-based loads the chrome build** unchanged.

## Support matrix

| Browser | Engine   | Build to load        | Notes                                            |
|---------|----------|----------------------|--------------------------------------------------|
| Chrome  | Chromium | `dist/chrome`        | Primary target; MV3 service-worker background    |
| Edge    | Chromium | `dist/chrome`        | Same build; separate store listing               |
| Brave   | Chromium | `dist/chrome`        | Same build; installs from the Chrome Web Store   |
| Opera   | Chromium | `dist/chrome`        | Same build; separate add-ons store               |
| Firefox | Gecko    | `dist/firefox`       | MV3 with event-page background; AMO signing      |
| Safari  | WebKit   | converted from `dist/chrome` | Requires Xcode conversion; App Store distribution |

## Chromium family (Chrome, Edge, Brave, Opera)

Local install:

1. `npm run build:chrome`
2. Open `chrome://extensions` (`edge://extensions`, `brave://extensions`,
   `opera://extensions`), enable **Developer mode**.
3. **Load unpacked** → select `dist/chrome/`.

Publishing notes:

- **Chrome Web Store**: upload `dist/chrome.zip` via the developer dashboard
  (one-time registration fee). MV3 extensions that operate on retailer pages
  attract manual review — the "single purpose" description and the
  justification for each `host_permissions` entry should be filled in
  carefully. Brave users install from the Chrome Web Store.
- **Edge Add-ons**: separate (free) developer registration; the same
  `dist/chrome.zip` uploads unchanged.
- **Opera Add-ons**: separate submission; the chrome build is accepted as-is.

## Firefox (MV3)

Firefox's MV3 differs from Chromium's in two ways this project already handles
in `extension/manifest.firefox.json`:

- **Event-page background**: Firefox does not run MV3 background service
  workers; it uses `background.scripts` (an event page) instead of
  `background.service_worker`. Same source file, different manifest key.
- **`browser_specific_settings.gecko`**: the add-on id and
  `strict_min_version` (127.0): Firefox 127 is the first release that prompts for host permissions at install for MV3 extensions; on older Firefox the store content scripts would never inject. The popup also detects missing host access and offers a "Grant store access" button (`permissions.request`).

Local install (temporary, resets on restart):

1. `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on…** → select `dist/firefox/manifest.json`.

Publishing notes:

- Permanent installs require **AMO signing**: submit `dist/firefox.zip` at
  addons.mozilla.org (listed or self-distributed/unlisted — unlisted still
  goes through automated signing). Release builds of Firefox refuse unsigned
  extensions.

## Safari (macOS)

Safari loads WebExtensions only when wrapped in a native app via Xcode:

1. `npm run build:chrome` (Safari consumes the Chromium-style build).
2. `xcrun safari-web-extension-converter dist/chrome` — generates an Xcode
   project wrapping the extension (add `--macos-only` if you don't want the
   iOS target).
3. Open the project in Xcode, set your signing team, build & run once, then
   enable the extension in Safari → Settings → Extensions. For local unsigned
   development you must also enable "Allow unsigned extensions" in Safari's
   Develop menu each session.
4. Distribution is through the **App Store** (or notarized Developer ID
   builds), which requires an Apple Developer account.

Caveats: Safari's MV3 support (16.4+) is the least complete of the three
engines — background service workers, `scripting`, and parts of `storage` have
had version-specific quirks, and promise-vs-callback behavior differs (the
`compat.js` shim covers the API surface this extension uses). Treat Safari as
"expected to work after conversion, verify by hand" rather than CI-verified.
