# Juzt — agent checkpoint

Rolling development log. Read this first when resuming work.

## Baseline

- Repo: `ankbuitv/Weby`
- Session branch: `arena/01a10c8a-weby`
- V2 baseline commit: `88ae7e8` (tag `v2-baseline`, tag `v2-pre-juzt`)
- V2 = Electron 31 + React 18 + TS, one `WebContentsView` used as a "hole" behind the
  renderer, single window, single tab, annotation canvas in the renderer.

## Last known good commit

- see `git log --oneline -1` (each milestone below notes its commit)

## Performance findings (profiled by code inspection of V2)

1. `App.tsx` viewport effect: `ResizeObserver` + `window.resize` both call
   `setViewportRect()` (unused state → wasted React render on the whole app) **and**
   `window.stage.setViewport()` (an `invoke` round-trip → `setBounds` on the native
   view) on *every* observer/resize tick, with no change detection. Resize storms
   (Alt+Tab restore, maximize) queue a backlog of IPC + native relayouts.
2. Main `layout()` calls `setBounds()` unconditionally on every window event
   (`resize`, `maximize`, `unmaximize`, `restore`) *and* on every renderer
   `viewport:set` → duplicate, uncoalesced native bounds writes.
3. `AnnotationCanvas.redraw()` ends with `setTick()` → a full React re-render of the
   whole PREP app on every pointer frame while drawing, plus `pointermove` is not
   coalesced and React's synthetic `pointermove` handler runs at raw mouse rate.
4. Laser trail: a `requestAnimationFrame` loop that runs **forever** (never stops)
   and calls `redraw()` (→ React render) every frame while the laser tool is active.
5. `redraw()` re-strokes the entire history (all strokes × all points) per frame —
   O(n²) over a lesson; no separate committed/live canvas layers.
6. Spotlight writes a full-window `radial-gradient` background string on **every
   `pointermove`** → full-area raster + style recalculation per mouse event.
7. `backdrop-filter: blur(16px)` toolbar + `blur(4px)` palette overlay over a full
   composition stack; expensive on integrated GPUs.
8. `websited` view uses `backgroundThrottling: false` (needed for live video, but
   should be per-view and only for the active/presented view).
9. Frozen frame kept as a huge PNG data-URL in React state (decode + memory).
10. Settings writes are synchronous `fs.writeFileSync` on the main thread per patch
    (zoom/etc.), and zoom changes send two IPC calls (`setZoom` + `setSettings`).
11. Z-order bug: V2 tried an undocumented `addChildViewAtIndex()` (not part of
    Electron 31's API) inside a try/catch. Electron 31 has the documented
    `View.addChildView(view, index?)`; the new code uses it (view placed at index 0,
    behind the UI renderer) instead of the swallowed-error hack.

## Fixes applied

(see PERF section below once implemented)

## Status

- [ ] typecheck
- [ ] tests
- [ ] build
- [ ] windows artifacts (CI)

---

# Milestone: rewrite layer compiles, tests run green

## This milestone

**Verified now (re-run, not remembered):**

| check | command | result |
| --- | --- | --- |
| main typecheck | `tsc --noEmit -p tsconfig.main.json` | clean |
| renderer typecheck | `tsc --noEmit -p tsconfig.renderer.json` | clean (was 174 errors) |
| tests | `npm test` | 81/81 pass |
| build | `npm run build` | `dist/renderer` + `dist/main` written |
| icons | `npm run icons` | `build/icon.png` (512²), `build/icon.ico` (16…256) |

**Renderer rewritten against the new store/action seam** (files deleted in the
previous pass are now rebuilt, not patched):

- `App.tsx` — PREP shell: title bar with the LIVE/FROZEN/PRIVACY pill, tab strip
  (46 px tabs, 18 px favicons, pinned compact, overflow menu), card frame drawn
  from `EV.GEOM`, single-mode audience view + private pane, status hints, and the
  panel/palette/toast mounts.
- `components/Toolbar.tsx` — floating 42 px toolbar; website tools + whiteboard
  tools, one flyout at a time, colour grid and sliders behind "…".
- `components/Palette.tsx` — Ctrl+L, 680 px, globe icon, no prefill, no permanent
  help text, `>` command mode through `matchCommands`.
- `components/Panels.tsx` — settings sheet (7 tabs), backgrounds + library,
  scenes, notes/timer, camera, permission + screen pickers, tab context menu,
  diagnostics, toasts, first-run setup, internal pages (new tab / favorites /
  history / boards / about).
- `annotation/AnnotationLayer.tsx` + `live/overlay.tsx` — the transparent
  WebContentsView that sits above the native page: ink model, laser, spotlight,
  masks, camera drag.
- `live/live.tsx` — audience renderer (backgrounds, card, whiteboard, ink,
  holding/privacy/freezing), fed only by `LivePayload`.
- `styles/global.css` — full dark-premium stylesheet, no `backdrop-filter` over
  the card, transitions limited to transform/opacity.

## Bugs the tests found (fixed, not papered over)

1. `shared/url.ts` accepted `data:`/`blob:` navigation — a typed address could
   load a hand-rolled document into a tab. Now only `http/https/juzt/about` are
   navigable, and a bare `localhost:5173` still resolves (the colon is not a
   scheme when it looks like a host).
2. `shared/url.ts` refused `localhost:5173` / `host:port` input because the port
   was read as an unknown scheme. Host-shaped input now falls through to host
   handling instead of erroring.
3. `live/ink.ts` — redoing an undone erase **duplicated** the restored strokes
   (its inverse op appended the live list to itself). Undo now replays the exact
   pre-op snapshot, so z-order survives undo/redo.
4. `live/ink.ts` + `whiteboard/WhiteboardEditor.tsx` generated ids from
   `Date.now()` alone → two strokes finishing in the same millisecond could share
   an id and be deleted together. Both now use a monotonic counter
   (`newInkId`, `newId`).
5. `shared/tabs.ts` — `sameRect` treated `null` and `undefined` as *different*,
   which would trigger a pointless `setBounds`. Now "both empty" counts as no
   change, and sub-pixel differences are ignored (integer bounds are what the
   native view actually receives).
6. `shared/whiteboard.ts` — a document from a *newer* schema was silently
   migrated (dropping unknown fields) and would then be overwritten on autosave.
   It is now refused, as is anything that is not recognisably a board.
7. `main/tabs.ts` — Ctrl+Shift+T appended the reopened tab instead of returning
   it to its original slot.
8. `main/ipcutil.ts` — added a sender-alive guard so a handler cannot run work for
   a WebContents that has already gone away.
9. `main/app.ts` — a stale `boards.setName('', '')` ran on **every** settings
   change.

## Click-through: a documented Electron limitation, handled honestly

`setIgnoreMouseEvents` exists on `BrowserWindow`/`BaseWindow` only — there is **no
per-view click-through** in Electron 31 (`View` and `WebContents` both lack it).
So the card overlay cannot be "transparent to the mouse while visible".

Chosen architecture:

- the overlay is **only mapped** while it must capture the pointer: a drawing tool
  is active, committed ink is on screen, an audience effect is on the card, or the
  teacher is in explicit camera-reposition mode;
- the rest of the time the view is hidden and the website keeps its normal mouse
  behaviour, untouched;
- moving the camera on the card is therefore an explicit mode (Camera panel →
  *Reposition*, or the hint chip; Esc returns the mouse to the page).

## Still open (next actions)

1. `scripts/` — ✅ icon generator; still to do: a small `scripts/verify-pack.mjs`.
2. Wire the whiteboard editor's `wbView` into `EV.GEOM`-driven sizing in single
   mode; confirm `WhiteboardEditor` fills the card without a ResizeObserver storm.
3. LIVE **web** presenting path end-to-end: single mode stage view, dual-mode
   handoff, 150–300 ms fade, stale-completion guard (main side exists — needs a
   real smoke test on Windows).
4. `SETTINGS` audit: every `Settings` field must be reachable from the UI.
5. README, `AGENT_CHECKPOINT.md` upkeep, GH workflow (done: `build.yml`).
6. Windows EXE: only CI can produce them (no Wine/Windows here).
