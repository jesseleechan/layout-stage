# Layout Stage

Next.js (App Router) + TypeScript editor that turns 1–3 website screenshots into a Pinterest pin or
Etsy listing image. Spec: `docs/HANDOFF.md`. Behavioral reference: `reference/layout-stage.html`
(match its behavior, layout and rendering math).

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
- `lib/render/` units/geometry, background, shot, export — shared by preview and export
- `lib/images.ts` image blobs in IndexedDB + object URLs; `lib/persist.ts` autosave + saved styles
- `lib/arrange.ts`, `lib/snap.ts` (incl. safe-area targets), `lib/align.ts` (align/distribute),
  `lib/scroll.ts` (moving a crop's visible window), `lib/samples.ts`
- `lib/capture/` URL capture: `server.ts` (Playwright, the only file to touch when swapping the
  browser for hosting), `url-guard.ts` + `address.ts` (public addresses only), `guard-proxy.ts`
  (every capture-browser connection is checked here; Playwright routing misses redirect hops),
  `png.ts` (tall pages are captured in slices and joined), `banners.css` (consent-banner selectors,
  read at run time), `client.ts`; route in `app/api/capture/route.ts`. `CAPTURE_DEBUG=1` logs timings.
- `components/` one file per panel / surface
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
  goldens don't depend on installed fonts. Keep sample text inside the subset (Latin plus arrows).
- **Refresh goldens** after an intended rendering change with `npm run test:e2e:update`, then look at
  every PNG. If CI renders differently, run the **Update goldens** workflow on the branch (Actions → Run
  workflow); it regenerates them on the runner, commits changed PNGs and starts CI.
- **CI** (`.github/workflows/ci.yml`, every push and PR): `npm ci`, typecheck, unit tests, `next build`,
  e2e against `next start`. Reproduce with `npx next build && CI=1 npx playwright test`.

## Conventions

- Positions are canvas px; frame and background sizes are units of 1/1000 of the canvas's short side.
- Live edits (`edit`) never save an undo step; `commit()` on drag end / slider release; discrete
  actions commit themselves. Every undo step autosaves to IndexedDB.
- Ask before adding a dependency the handoff doesn't name.
