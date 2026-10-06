# Browser engine & website compatibility

This document records what Juzt's engine actually is, what was verified, and —
just as important — what was **not** verified and what Juzt deliberately does
not do. Read it before promising a site "works in Juzt".

## Engine

| | |
|---|---|
| Electron | **44.5.1** (stable, released 2026‑09‑29) |
| Chromium | **152.0.7977.130** |
| V8 | **15.2** |
| Node.js | **24.21.0** |

Juzt was on Electron 31.3.0 (Chromium 126). The jump is 13 Electron majors and
26 Chromium majors, and it is the single biggest compatibility improvement in
this release: a large share of "this site doesn't work in Juzt" reports are
sites feature‑testing an API that simply did not exist in Chromium 126.

### Why the latest stable rather than an incremental hop

Electron supports the latest three stable majors; 32 through 43 are all past
end of life. Landing on an EOL version would trade a known‑good engine for one
with unpatched security fixes, so the upgrade went to the newest stable
(44.5.1). Only stable releases are used — never alpha, beta or nightly; at the
time of writing the newest stable is 44.5.1 and the newest prerelease is
45.0.0‑alpha, so nothing prerelease is referenced anywhere in this repo.

### What the upgrade touched

`package.json` / `package-lock.json` only, plus three config fixes:

- `electron-builder` 24.13.3 → 26.15.3 (24 cannot package an Electron 44 app).
- `@types/node` 20 → 24 (Electron 44 bundles Node 24).
- `build.win.sign` and `build.win.signingHashAlgorithms` were removed from the
  electron‑builder config: electron‑builder 26 no longer accepts them (code
  signing is configured through `signAndEditExecutable` / `signtoolOptions`).
  Juzt ships unsigned, which is unchanged behaviour.

Both TypeScript projects compile clean against the Electron 44 typings, and the
APIs Juzt depends on all still exist with the same signatures:

| API | Status in Electron 44 |
|---|---|
| `BaseWindow.contentView` / `View.addChildView(view, index?)` | unchanged |
| `BrowserWindow.webContents` | unchanged |
| `WebContentsView.webContents` | unchanged |
| `session.loadExtension` / `removeExtension` / `getAllExtensions` | unchanged |
| `session.fromPartition` + persistence | unchanged |
| `setWindowOpenHandler`, `capturePage`, `setUserAgent`, `setPermissionCheckHandler` | unchanged |

`npm test` (111 tests) and `npm run build` both pass.

## Website identity

Juzt presents a Chrome‑compatible User‑Agent built **from the bundled Chromium
version**:

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36
```

Rules enforced in `src/shared/engine.ts` and unit‑tested in `test/engine.test.mjs`:

- The advertised Chrome major is **always** the real one. There is no code path
  that can advertise a newer version — `buildWebUserAgent` takes
  `process.versions.chrome` and nothing else.
- The default carries no `Electron/x.y.z` and no `Juzt/x.y.z` token.
- The `Electron/` and `Juzt/` tokens are available as explicit per‑site
  overrides for the rare site that needs them, never by default.
- `sanitizeUserAgent()` strips any application token from a stock Electron UA,
  as a belt‑and‑braces guard.

The three modes, per origin or global (Settings → Browser):

| Mode | UA |
|---|---|
| `clean` (default) | `… Chrome/152.0.7977.130 Safari/537.36` |
| `app` | `… Chrome/152.0.7977.130 Juzt/1.0.0 Safari/537.36` |
| `electron` | `… Chrome/152.0.7977.130 Electron/44.5.1 Safari/537.36` |

Juzt's **internal** pages are not touched: they keep the default identity, so
nothing in the private workspace changes how it identifies itself.

### Client hints — the honest limitation

`navigator.userAgent` and the `Sec-CH-UA` header family are rewritten in
Chromium's own network stack (`session.webRequest.onBeforeSendHeaders`), so they
can never disagree with each other and no JavaScript is injected into any page.
There is no global `navigator` monkey‑patching anywhere in Juzt.

Juzt reports a **`Chromium` brand with the accurate version**, because Juzt
really is Chromium:

```
Sec-CH-UA: "Chromium";v="152", "Not:A-Brand";v="99"
```

**Limitation, stated plainly:** Electron/Chromium provides no supported way to
emit a `"Google Chrome"` brand hint. Juzt does not fake one. A site that gates
on the *brand* rather than the *version* will mis‑detect Juzt, and spoofing the
brand would be both a lie and a detection hazard the moment the engine
advances. If you find such a site, the version is already correct — that is a
site bug, not something to work around by lying.

## Feature and codec reality

`src/shared/engine.ts` carries `ENGINE_FEATURES`, each gated on the Chromium
major that introduced it, so Juzt cannot claim support the engine lacks. The
Settings → Browser panel lists them with their real state.

- **Provided:** WebGL 2, WebAssembly (+ GC), IndexedDB, Service Workers,
  WebSockets, WebRTC, MediaDevices/getUserMedia, Web Audio, Picture‑in‑Picture,
  Fullscreen, Async Clipboard, Notifications (per‑site permission, asked
  privately), WebCodecs, Media Source Extensions.
- **Codecs in the official Electron build:** H.264, AAC, VP8, VP9, Opus, WebM,
  MP4, and AV1 decode. Juzt does not claim AV1 *encode*.
- **Widevine / DRM: not available.** Electron does not bundle Widevine, and
  Juzt will not circumvent DRM or copy Widevine binaries out of a Chrome
  installation. Netflix, Disney+, Spotify and similar services will not play.
  The Settings → Browser panel says so explicitly rather than letting a teacher
  discover it mid‑lesson.

## Extensions

- Extensions load through `session.loadExtension()` **only**, into the same
  persistent `persist:juzt` session as website tabs, so their storage and
  content scripts work.
- Officially supported path is **Load Unpacked** from a folder the teacher
  already has on disk. There is no Chrome Web Store integration, no scraping and
  no downloading — Juzt will not install anything the teacher did not point at.
- **Not every Chrome extension works.** Juzt reports Loaded / Disabled / Failed
  / Partially compatible / Unknown per extension, with the real load error
  visible in Developer Mode. Nothing is silently dropped and nothing is
  pretended.
- Manifest V2 runs on Chromium 152 but is reported as *Partially compatible*,
  because Chromium has removed several MV2‑only capabilities. Manifest V3 is
  reported as Loaded. An unknown `manifest_version` is refused, not guessed at.
- Juzt's privileged pages, the preload bridge and LIVE live in the default
  session; extension code cannot reach them. Extension content scripts run on
  websites only. An extension's options page opens in a bare window with no Juzt
  preload.
- Juzt never executes arbitrary Node code from an extension directory: the main
  process reads and validates `manifest.json` and hands the path to Chromium.
- Safe Mode pauses every loaded extension for website tabs and resets the
  identity to the default, **without deleting** the approved list or per‑site
  overrides. Available as `> safe mode` and in Settings.
- **Toolbar action popups are not available.** Chromium exposes extensions to
  Electron as a subset of the API — content scripts, background pages, storage
  and messaging work, but Electron has no concept of an extension's toolbar
  button. An extension that puts its whole interface in an `action` /
  `browserAction` popup will load and do nothing visible. Juzt does not fake a
  popup button; an options page declared in the manifest is opened directly.
  This is stated in Settings → Extensions rather than discovered mid-lesson.
- Settings → Extensions carries a **Performance** section with the live loaded
  count and "Disable all extensions temporarily", which drops the loaded
  instances and keeps the configuration. GPU acceleration is never disabled to
  paper over extension lag.
- Known interaction: Juzt rewrites request headers in its own network stack to
  keep the User-Agent and client hints consistent. An extension that also uses
  `chrome.webRequest` is subject to the limitation every Electron app has — the
  two interception layers do not observe each other's changes.
- No online catalog or backend exists. The architecture (a persisted list of
  approved directory references reloaded on startup, each failure isolated) is
  what a future catalog would plug into.

## What still needs a human to verify

This sandbox cannot download the Electron binary (the release host is
TLS‑blocked) and cannot run Wine, so the app was never launched here and no
Windows EXE was produced locally. The Windows build runs in GitHub Actions:
`electron-builder --win --x64 --publish never` produces **Juzt Setup 1.0.0.exe**
and **Juzt Portable 1.0.0.exe**.

Verified here: typecheck (both projects), 111 unit tests, `npm run build`, and
the Windows packaging run on GitHub Actions.

**Not verified here, check on a real Windows machine:**

1. Launch with no holding screen; `Ctrl+L example.com` then `Ctrl+L google.com`
   both render; `Ctrl+T` + a second site; tab switching without overlap.
2. `Ctrl+Shift+N` whiteboard + draw; WEB → BOARD → WEB keeps both alive.
3. F8 privacy covers the card only and F8 again restores exactly; F9 freeze is
   one snapshot; F10 spotlight.
4. Start Presentation opens a separate LIVE window; PREP stays a normal
   workspace; presenting a website shows it in LIVE while PREP stays private;
   presenting a whiteboard shows the whiteboard.
5. Camera and microphone permission prompts, and screen sharing.
6. Downloads land in the Downloads folder.
7. `capturePage` still produces a usable freeze frame.
8. DevTools open on a website tab.
9. Alt+Tab away and back; website scrolling; whiteboard switching.
10. The extension matrix: 0 / 1 / several extensions × static vs MP4 background
    × 1 vs 5 tabs. **Do not** diagnose extension lag by disabling GPU
    acceleration globally.

Run `node scripts/compat-check.mjs` on that machine for the per‑site report
(console errors, network failures, live feature detection, actual codec
support). It writes `compat-report.json` and never edits Juzt to force a site
through.

## Regression rules carried forward

The upgrade must not reintroduce any of: a blank white website view, broken
`WebContentsView` z‑ordering, broken annotation, broken tab switching, broken
PREP/LIVE isolation, or broken camera/mic permission handling. `test/security.test.mjs`
guards the isolation invariants — LIVE can only reach its own effect‑only
channels, and the new `compat:*` / `ext:*` channels are asserted PREP‑only.
