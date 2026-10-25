# Layout Stage

Next.js (App Router) + TypeScript editor that turns 1–3 website screenshots into a Pinterest pin or
Etsy listing image. Spec: `docs/HANDOFF.md`. Behavioral reference: `reference/layout-stage.html`
(match its behavior and rendering math). The editor's look and layout follow Shots (shots.so): floating
clusters on top, a Mockup / Canvas tabbed panel on the left, the layout count and live layout presets on
the right, a floating toolbar under the canvas.

## The rule

**Preview and export must render identically: change both or neither.** The DOM preview
(`components/Stage.tsx`, CSS box-shadow / border-radius / object-position) and the canvas export
(`lib/render/shot.ts`, `lib/render/export.ts`) read the same formulas from `lib/render/`. The
background is drawn by `lib/render/background.ts` for both.

## Commands

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests (tests/unit)
npm run test:e2e     # Playwright: golden exports + capture checks (tests/e2e); starts its own dev server on :3100
npm run test:e2e:update                  # refresh golden PNGs after an intended rendering change
npx playwright install chromium          # once per machine, for URL capture and e2e tests
```

## Layout

- `lib/model.ts` types, defaults, presets, built-in styles, swatches
- `lib/store.ts` Zustand store (single source of truth) + actions; `lib/history.ts` 80-step undo
- `lib/render/` units/geometry, background (incl. texture), shot, export — shared by preview and export
- `lib/images.ts` image blobs in IndexedDB + object URLs + stored thumbnails (`useThumbUrl`); images
  are downscaled at ingest by the budget in `lib/image-sizing.ts`; `lib/persist.ts` autosave + saved styles
- `lib/overlays.ts` headline / badge / watermark model, fonts and sanitizer; `lib/render/overlay-layout.ts`
  (pure, scale-free text layout), `lib/render/overlays.ts` (`drawOverlays`, the one drawing function for
  the preview's overlay canvas and the export), `lib/render/overlay-fonts.ts` (FontFace loading, measure)
- `lib/arrange.ts` (starting positions: `showcase` Scroll / Columns / Editorial, whole pages running off the
  canvas, the default; `classic` cascades; leaves room for a top/bottom headline via `layoutRoom`),
  `lib/canvas-size.ts` (switching canvas sizes keeps the work: per-size placements, re-arrange when fresh,
  else scale as one piece), `lib/media.ts` (the media gallery, `doc.media`: every image added, up to 12,
  oldest unused ones make room; `putImage` / `slotFor` place any image in a layout), `lib/crop.ts`
  (free height: crop `custom` with `Slot.ar`, from the Height slider or the bottom-edge handle; snaps
  to Full or a preset within 1%),
  `lib/snap.ts` (incl. safe-area targets), `lib/align.ts` (align/distribute), `lib/scroll.ts` (moving a
  crop's visible window), `lib/samples.ts`
- Outputs: `lib/sets.ts` (derived compositions for Export all sizes and the Etsy listing set),
  `lib/render/palette-card.ts`, `lib/palette.ts` (site colors; Match site colors), `lib/zip.ts`
  (stored ZIP writer), `lib/video/` (scrolling video: `timing.ts`, `render.ts` drawing each frame with the
  shared renderers, `mp4.ts` a small MP4 muxer for WebCodecs H.264), `lib/pin-text.ts` (Pin text
  suggestions)
- Whole-site capture: `lib/capture/pages.ts` (the page list from a site's menu and sitemap, read by
  `findSitePages` in `server.ts`; route `app/api/pages/route.ts`), `captureSite` in `jobs.ts` (the pages
  into Media, one after another)
- `lib/capture/` URL capture: `server.ts` (Playwright, the only file to touch when swapping the
  browser for hosting), `url-guard.ts` + `address.ts` (public addresses only), `guard-proxy.ts`
  (every capture-browser connection is checked here; Playwright routing misses redirect hops),
  `png.ts` (tall pages are captured in slices and joined), `banners.css` (consent-banner selectors,
  read at run time), `options.ts` + `selectors.ts` (option and hide-selector validation), `auth.ts`
  (basic-auth credentials: per request, origin-bound, never stored), `recapture.ts` + `jobs.ts`
  (re-capture keeping framing, desktop + phone), `client.ts`; route in `app/api/capture/route.ts`.
  `CAPTURE_DEBUG=1` logs timings.
- `lib/projects/` projects library and sync: `model.ts` pure rules (store layout, `planSync`, names,
  upload rules), `local.ts` projects in IndexedDB (the autosave is the open project's canvas; migrates
  the old single autosave), `library.ts` `useProjects` (list, actions, background sync), `api.ts`
  browser transfers; `blob-upload.ts` and `server/blob-store.ts` are the only Vercel Blob code;
  `server/fs-store.ts` the local store (`.data/sync`, `PROJECTS_STORE_DIR`, `off` disables);
  `server/api.ts` route logic for `app/api/projects/`. UI: `components/ProjectsControl.tsx`,
  `components/ProjectsSheet.tsx`
- `components/` one file per panel / surface: `Editor.tsx` (the shell), `TopBar.tsx` (the three top
  clusters), `LeftPanel.tsx` (Mockup: screenshots, `MediaPanel.tsx` the gallery, frame; Canvas:
  background; there is no Styles or Text & logo panel, and `LegacyOverlays.tsx` only lets a canvas saved
  with overlays on turn them off; the overlay model and renderer stay for later),
  `RightPanel.tsx` (`LayoutPresets.tsx` live thumbnails drawn with `renderComposition`, then the selected
  layout), `Stage.tsx` (canvas + floating toolbar); `controls.tsx` holds the pill slider and `Tiles`
- `proxy.ts` (Next 16's request interceptor, formerly `middleware.ts`): every request needs HTTP Basic
  auth when `ACCESS_PASSWORD` is set (any user name)

## Hosting

Vercel (`docs/DEPLOY.md`). On Vercel (or with `CHROMIUM_PACK_URL`), `lib/capture/server.ts` launches
`@sparticuz/chromium-min`'s Chromium through Playwright: downloaded to `/tmp` on a cold start,
single-process (one browser per capture), WebGL off. Locally it uses Playwright's own Chromium. Keep
chromium-min, `DEFAULT_CHROMIUM_PACK_URL` and Playwright's Chromium major in step. Hosted responses must
stay under 4.5 MB: a capture over 4 MB as PNG is sent as WebP slices (`multipart/form-data`) that
`captureUrl` joins into one PNG; local captures are always PNG.

## Tests and CI

- **Goldens**: `tests/e2e/golden.spec.ts` exports fixed compositions (`tests/e2e/fixtures.ts`) and
  compares them with `tests/e2e/__golden__/*.png` (tolerance in `playwright.config.ts`). E2E pages may
  only reach the app (`tests/e2e/local.ts`), so the suite runs offline; `CAPTURE_ONLINE=1` enables the
  one real-capture test.
- **Sample fonts**: the samples draw text with bundled OFL fonts in `public/fonts/` (Gelasio for Georgia,
  Inter for Helvetica), loaded with the FontFace API in `lib/samples.ts` before a sample is drawn, so
  goldens don't depend on installed fonts. Keep sample text inside the subset (Latin plus arrows). CI's
  runner places glyphs a fraction of a pixel differently from this repo's cloud containers, so the
  committed goldens come from CI (the Update goldens workflow); in a container, text-heavy goldens can
  fail with diffs only on text edges: look at the diff PNGs and let CI judge.
- **Refresh goldens** after an intended rendering change with `npm run test:e2e:update`, then look at
  every PNG. If CI renders differently, run the **Update goldens** workflow on the branch (Actions → Run
  workflow); it regenerates them on the runner, commits changed PNGs and starts CI.
- **CI** (`.github/workflows/ci.yml`, every push and PR): `npm ci`, typecheck, unit tests, `next build`,
  e2e against `next start`. Reproduce with `npx next build && CI=1 npx playwright test`.

## Conventions

- Positions are canvas px; frame and background sizes are units of 1/1000 of the canvas's short side.
- Live edits (`edit`) never save an undo step; `commit()` on drag end / slider release; discrete
  actions commit themselves. Every undo step autosaves to IndexedDB.
- Switching projects calls `showProject`: it resets history like a reload and is not an undo step.
- Nothing big passes through a function (4.5 MB cap): captures use WebP slices; project images use
  Blob client uploads and presigned GETs (locally, 4 MB chunks). Keep project pushes spaced out (Hobby
  Blob operation budget).
- Ask before adding a dependency the handoff doesn't name (approved so far: `@vercel/blob`,
  `@sparticuz/chromium-min`; `zod` is pinned to a patched 4.x through `overrides`).
