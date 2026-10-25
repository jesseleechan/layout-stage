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
npx playwright test --update-snapshots   # refresh golden PNGs after an intended rendering change
npx playwright install chromium          # once per machine, for URL capture and e2e tests
```

## Layout

- `lib/model.ts` types, defaults, presets, built-in styles, swatches
- `lib/store.ts` Zustand store (single source of truth) + actions; `lib/history.ts` 80-step undo
- `lib/render/` units/geometry, background, shot, export — shared by preview and export
- `lib/images.ts` image blobs in IndexedDB + object URLs; `lib/persist.ts` autosave + saved styles
- `lib/arrange.ts`, `lib/snap.ts`, `lib/samples.ts`
- `lib/capture/` URL capture: `server.ts` (Playwright, the only file to touch when swapping the
  browser for hosting), `url-guard.ts`, `banners.css`, `client.ts`; route in `app/api/capture/route.ts`
- `components/` one file per panel / surface

## Conventions

- Positions are canvas px; frame and background sizes are units of 1/1000 of the canvas's short side.
- Live edits (`edit`) never save an undo step; `commit()` on drag end / slider release; discrete
  actions commit themselves. Every undo step autosaves to IndexedDB.
- Ask before adding a dependency the handoff doesn't name.
