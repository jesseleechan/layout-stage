# Plan 008: A new layout preset, "Stack": one page in front, the others peeking out behind it

> **Executor instructions**: Follow this plan step by step, in order. Do NOT
> run the typecheck or the test suite after each step: the "Verify" lines under
> the steps describe what should be true, and are checked once, at the end.
> When every step is done, run the "Done criteria" in one pass (install,
> typecheck and the unit tests once each) and fix what they show. A "Verify"
> that is a quick `grep` or a file check may be run at any time. If anything
> in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cab4ee..HEAD -- lib/model.ts lib/arrange.ts tests/unit/arrange-presets.test.ts tests/e2e/layouts.spec.ts CLAUDE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 003 edits one unrelated bullet in `CLAUDE.md`; that is expected.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (positions only; no new rendering) — the look itself needs the owner's eye
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `0cab4ee`, 2026-11-15

## Why this matters

The right panel offers layout presets per number of layouts: Scroll / Framed / Close-up (one),
Columns / Split / Inset (two), Editorial / Columns / Bento / Spotlight (three). Every one of them
spreads the pages side by side or crops them into cells. None shows a *deck*: one page large and in
front with the next pages stacked behind it, each a little narrower and peeking out above. It is a
common look for "this template has several pages" pins, it reads well at feed size because one page
dominates, and it needs nothing but new starting positions and a z-order, which is exactly what the
arrangement system exists for. After this plan "Stack" is offered for two and three layouts.

## Current state

- `lib/model.ts` — the `Arrangement` type and `ARRANGEMENTS` list.
- `lib/arrange.ts` — starting positions for each arrangement (`arrange`), the preset list per count
  (`presetArrangements`), their names (`ARRANGEMENT_NAMES`), and helpers other modules use
  (`presetOf`, `showsWholePages`, `runsOff`, `startCrop`).
- `components/LayoutPresets.tsx` — draws a live thumbnail per entry of `presetArrangements(n)`; it
  needs **no change** (it is driven by the list and the names).
- `lib/media.ts`, `lib/store.ts`, `lib/sets.ts` — call `runsOff(a, i)` to decide whether a layout
  shows its page whole and keeps its top edge; they need no change once `runsOff` knows the new family.
- `tests/unit/arrange-presets.test.ts` — unit tests for the preset families.
- `tests/e2e/layouts.spec.ts` — asserts the preset names shown in the panel.

`lib/model.ts:80-82`:

```ts
export type Arrangement = 'showcase' | 'columns' | 'grid' | 'spotlight' | 'classic';
export const ARRANGEMENTS: readonly Arrangement[] = ['showcase', 'columns', 'grid', 'spotlight', 'classic'];
export const isArrangement = (a: unknown): a is Arrangement => ARRANGEMENTS.includes(a as Arrangement);
```

`lib/arrange.ts:24` and `:35-40` — the canvas shape kinds and the one-page ("Scroll") geometry, the
pattern for new parameters (widths are fractions of the canvas width, tops of its height):

```ts
type Kind = 'port' | 'sq' | 'land';
...
/** Scroll: the page's width (a phone capture's), and its top. */
const SCROLL: Record<Kind, { w: number; phoneW: number; top: number }> = {
  port: { w: 0.8, phoneW: 0.46, top: 0.115 },
  sq: { w: 0.74, phoneW: 0.4, top: 0.11 },
  land: { w: 0.62, phoneW: 0.3, top: 0.11 },
};
```

`lib/arrange.ts:100-119`:

```ts
/** The layout presets offered for n layouts, in order ('classic' no longer is), and their names.
 *  'columns' differs from showcase only with three, so it is only offered then. */
export const presetArrangements = (n: 1 | 2 | 3): Arrangement[] => (n === 3 ? ['showcase', 'columns', 'grid', 'spotlight'] : ['showcase', 'grid', 'spotlight']);
export const ARRANGEMENT_NAMES: Record<Arrangement, Record<1 | 2 | 3, string>> = {
  showcase: { 1: 'Scroll', 2: 'Columns', 3: 'Editorial' },
  columns: { 1: 'Scroll', 2: 'Columns', 3: 'Columns' },
  grid: { 1: 'Framed', 2: 'Split', 3: 'Bento' },
  spotlight: { 1: 'Close-up', 2: 'Inset', 3: 'Spotlight' },
  classic: { 1: 'Centered', 2: 'Cascade', 3: 'Cascade' },
};
/** The preset an arrangement shows as with n layouts: below three, columns is showcase. */
export const presetOf = (a: Arrangement, n: 1 | 2 | 3): Arrangement => (a === 'columns' && n < 3 ? 'showcase' : a);

/** Shows whole pages that run off the canvas (crop 'full'): showcase and columns. */
export const showsWholePages = (a: Arrangement) => a === 'showcase' || a === 'columns';
/** Layout i shows its page whole, keeping its top edge when its crop changes: in showcase and
 *  columns, and spotlight's lead page. */
export const runsOff = (a: Arrangement, i: number) => showsWholePages(a) || (a === 'spotlight' && i === 0);

const isPhoneCapture = (s: Slot) => s.source.kind === 'url' && s.source.options.width === 390;
```

`lib/arrange.ts:195-199` and `:269-279` — helpers to reuse:

```ts
/** A layout of width w whose top edge is at `top`. */
const fromTop = (s: Slot, cx: number, top: number, w: number): Placed => {
  const h = w / cropRatio(s);
  return { cx, cy: top + h / 2, w, h };
};
...
/** Pages too short to run off the canvas are centered in the room, scaled down (about the canvas's
 *  vertical center line) if they would end behind a bottom headline. */
function centerShort(spots: Placed[], room: Room, W: number, H: number): Placed[] {
```

`lib/arrange.ts:365-385` — `arrange` picks the geometry and sets the z-order (`doc.order` is bottom → top):

```ts
export function arrange(doc: Composition, n: 1 | 2 | 3 = doc.count, measure?: Measure | null): void {
  const { W, H } = doc;
  const room = layoutRoom(doc, measure);
  const a = arrangementOf(doc);
  const spots =
    a === 'grid' ? gridCells(W, H, n, room).map((c, i) => fillCell(doc.slots[i], c))
    : a === 'spotlight' ? spotlightSpots(doc, n, room)
    : a === 'classic' ? classicSpots(doc, n, room)
    : showcaseSpots(doc, n, room);
  spots.forEach((p, i) => { ...rounds and writes s.w, s.cx, s.cy... });
  // The editorial 3-up, and the classic one on square and landscape canvases, put the hero (layout 1
  // in showcase, layout 2 in classic) in front of the other two.
  const front = n === 3 && (a === 'showcase' || (a === 'classic' && canvasKind(W, H) !== 'port'));
  const vis = front ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i);
  doc.order = [...vis, ...[0, 1, 2].filter((i) => !vis.includes(i))];
}
```

`showcaseSpots(doc, 1, room)` (the `n === 1` branch) is the Scroll layout and does not look at the
arrangement, so it can serve "Stack with one layout".

`canContinuePage` (`lib/arrange.ts:215-222`) starts with
`if (!showsWholePages(arrangementOf(doc)) || doc.count !== 2) return false;`. It must stay false for
the new family, so do **not** add the new family to `showsWholePages`; add it to `runsOff` only.

`tests/unit/arrange-presets.test.ts:51-57` and the helpers at `:29-48` (`CANVASES`, `KINDS`, `pages()`,
`rects()`, `near()`):

```ts
  it('offers no cascades: Scroll, Framed, Close-up; Columns, Split, Inset; Editorial, Columns, Bento, Spotlight', () => {
    const names = (n: 1 | 2 | 3) => presetArrangements(n).map((a) => ARRANGEMENT_NAMES[a][n]);
    expect(names(1)).toEqual(['Scroll', 'Framed', 'Close-up']);
    expect(names(2)).toEqual(['Columns', 'Split', 'Inset']);
    expect(names(3)).toEqual(['Editorial', 'Columns', 'Bento', 'Spotlight']);
    for (const n of [1, 2, 3] as const) expect(presetArrangements(n)).not.toContain('classic');
  });
```

`tests/e2e/layouts.spec.ts:48` and `:57`:

```ts
    expect(await names()).toEqual(['Columns', 'Split', 'Inset']);
...
    expect(await names()).toEqual(['Editorial', 'Columns', 'Bento', 'Spotlight']);
```

Project rule (CLAUDE.md): "Preview and export must render identically: change both or neither." This
plan only changes starting positions and z-order, which both read from the same `Composition`, so no
rendering file is touched. Conventions: short plain comments; 2-space indent, single quotes,
semicolons; no linter; every number in `arrange.ts` sits in a named parameter table with a comment.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/arrange-presets.test.ts` | passes |
| Dev server (for the visual check) | `npm run dev` | serves http://localhost:3000 |
| E2E (only if Playwright's Chromium is installed) | `npx playwright test layouts --trace off` | passes |

## Scope

**In scope**:

- `lib/model.ts` (the `Arrangement` type, `ARRANGEMENTS`, and the doc comment above them)
- `lib/arrange.ts`
- `tests/unit/arrange-presets.test.ts`
- `tests/e2e/layouts.spec.ts` (the two name lists only)
- `CLAUDE.md` (the `lib/arrange.ts` bullet: add the new family to the list)

**Out of scope** (do NOT touch):

- `components/Stage.tsx`, `lib/render/**` — no rendering change; if you think one is needed, STOP.
- `components/LayoutPresets.tsx` — it is driven by `presetArrangements` and `ARRANGEMENT_NAMES`.
- `lib/variations.ts` (`RECIPES`), `lib/sets.ts` — Variations and the Etsy set keep their layouts.
- `showsWholePages` and `canContinuePage` — "One page" stays a two-column showcase feature.
- Golden PNGs (`tests/e2e/__golden__`) — no fixture uses the new family.
- Rotation, tilt, or per-layout frames — separate ideas listed in `plans/README.md`.

## Git workflow

- Branch: `advisor/008-stack-layout-preset`
- Commit message style from `git log`: `New layout presets: Framed, Split, Bento, Close-up, Inset, Spotlight, three Columns`.
  Suggested: `New layout preset: Stack (one page in front, the others behind it)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The family exists

`lib/model.ts`: add `'stack'` to the `Arrangement` union and to `ARRANGEMENTS` (before `'classic'`),
and one sentence to the doc comment: `'stack': the first page whole and in front, the others behind
it, each narrower and starting higher.`

`lib/arrange.ts`:

- Top-of-file comment: add a bullet for the family in the same style as the others:
  `- stack: the first page whole and in front, the others behind it, each narrower and starting a
  little higher, so their tops show above it ("Stack"); one layout is the Scroll.`
- `ARRANGEMENT_NAMES`: add `stack: { 1: 'Scroll', 2: 'Stack', 3: 'Stack' },`.
- `presetArrangements`:

  ```ts
  export const presetArrangements = (n: 1 | 2 | 3): Arrangement[] =>
    n === 3 ? ['showcase', 'columns', 'stack', 'grid', 'spotlight'] : n === 2 ? ['showcase', 'stack', 'grid', 'spotlight'] : ['showcase', 'grid', 'spotlight'];
  ```

  Update its comment: stack needs a page behind, so it is offered from two.
- `presetOf`: `(a === 'columns' && n < 3) || (a === 'stack' && n < 2) ? 'showcase' : a`, comment updated.
- `runsOff`: `showsWholePages(a) || a === 'stack' || (a === 'spotlight' && i === 0)`, comment updated
  ("…and every page of a stack").

**Verify**: `npm run typecheck` → exit 0 (the `Record<Arrangement, …>` types force every table to
have the new key; fix any table the compiler names).

### Step 2: The geometry

In `lib/arrange.ts`, next to the other parameter tables:

```ts
/** Stack: the front page's width (a phone capture's) and the top of the page furthest back; how much
 *  lower each page in front of another starts (a fraction of the canvas height); and how much
 *  narrower each page behind is (a fraction of the front page's width). */
const STACK: Record<Kind, { w: number; phoneW: number; top: number; peek: number; shrink: number }> = {
  port: { w: 0.78, phoneW: 0.46, top: 0.07, peek: 0.05, shrink: 0.1 },
  sq: { w: 0.7, phoneW: 0.4, top: 0.08, peek: 0.055, shrink: 0.1 },
  land: { w: 0.56, phoneW: 0.3, top: 0.08, peek: 0.06, shrink: 0.1 },
};
```

And next to `spotlightSpots`:

```ts
/** Stack: layout 1 in front; layout k + 1 is k pages behind it, narrower by `shrink` each and
 *  starting `peek` higher each, all on the canvas's center line. */
function stackSpots(doc: Composition, n: 2 | 3, room: Room): Placed[] {
  const { W, H } = doc;
  const P = STACK[canvasKind(W, H)];
  const w = (isPhoneCapture(doc.slots[0]) ? P.phoneW : P.w) * W;
  const top = Math.max(P.top * H, room.t);
  const spots = doc.slots.slice(0, n).map((s, k) => fromTop(s, W / 2, top + (n - 1 - k) * P.peek * H, w * (1 - P.shrink * k)));
  return centerShort(spots, room, W, H);
}
```

In `arrange`:

- Add the branch before the final `showcaseSpots` fallback:
  `: a === 'stack' && n > 1 ? stackSpots(doc, n, room)`.
- Z-order: the front page is layout 1, so the visible order bottom → top is `n-1 … 0`:

  ```ts
  const vis = a === 'stack' ? Array.from({ length: n }, (_, i) => n - 1 - i) : front ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i);
  ```

  Extend the comment above it with: `A stack puts layout 1 in front and the last one at the back.`

`startCrop` needs no change: `runsOff` now returns true for every stack layout, so each page starts
whole (`'full'`).

**Verify**: `npm run typecheck` → exit 0; `npm test` → only the name-list test in
`tests/unit/arrange-presets.test.ts` fails (expected until Step 3). If anything else fails, STOP.

### Step 3: Unit tests

In `tests/unit/arrange-presets.test.ts`:

- Update the name-list test (and its title) to
  `names(2)` → `['Columns', 'Stack', 'Split', 'Inset']` and
  `names(3)` → `['Editorial', 'Columns', 'Stack', 'Bento', 'Spotlight']`; `names(1)` is unchanged.
- Add `describe('stack', ...)` using the file's helpers (`pages(kind, 'stack', n)`, `rects`, `near`,
  `KINDS`, `CANVASES`), modeled on `describe('spotlight', ...)`:
  1. For every kind and `n` of 2 and 3: every layout's crop is `'full'`; every layout is centered
     (`near(s.cx, W / 2)`); layout 1 is last in `d.order.filter((i) => i < n)` (in front) and the
     last layout is first (at the back).
  2. Each page behind is narrower and starts higher: for `k` from 1 to `n-1`,
     `rects[k].w < rects[k-1].w` and `rects[k].t < rects[k-1].t`, and the top of the page furthest
     back is `>= 0`.
  3. The tops are evenly spaced: with three, `near((rects[0].t - rects[1].t), (rects[1].t - rects[2].t))`.
  4. Long pages run off the bottom: `rects[0].t + rects[0].h > H` for the default 9000 px pages.
  5. One layout is the Scroll: `pages(kind, 'stack', 1)` has the same `cx`, `cy`, `w` as
     `pages(kind, 'showcase', 1)`, and `presetOf('stack', 1)` is `'showcase'`, `presetOf('stack', 2)` is `'stack'`.
  6. A saved canvas keeps it: `sanitizeComposition(clone(pages('port', 'stack', 3)))?.arrangement` is `'stack'`.
  7. A new image in a page behind keeps that page's top edge and width: take `d = pages('port', 'stack', 3)`,
     note `rectOf(d.slots[2])`, call `putImage(d, 2, item('x', 1440, 5000))`, and expect the new rect's
     `t` and `w` to be within a pixel of the old ones and the crop to be `'full'`.
  8. Switching canvas size re-arranges a fresh stack: `resizeCanvas(d, 2000, 2000, null)` on a fresh
     `pages('port', 'stack', 3)` returns `'arranged'` and `isArranged(d, null)` is true afterwards
     (model on the existing size-switch test in this file, around line 230).
  9. `canContinuePage(pages('port', 'stack', 2), null)` is `false`.

**Verify**: `npx vitest run tests/unit/arrange-presets.test.ts` → passes; `npm test` → all pass.

### Step 4: The e2e name lists

In `tests/e2e/layouts.spec.ts` update the two expectations to
`['Columns', 'Stack', 'Split', 'Inset']` and `['Editorial', 'Columns', 'Stack', 'Bento', 'Spotlight']`.
Change nothing else in the spec.

**Verify**: `grep -n "'Stack'" tests/e2e/layouts.spec.ts` → 2 matches. If a browser is available,
`npx playwright test layouts --trace off` → passes; otherwise say CI must confirm.

### Step 5: Look at it, and hand the look to the owner

This plan's numbers were chosen without seeing them rendered. If you can run a browser:

1. `npm run dev`, open the editor, pick three layouts, pick **Stack**.
2. Take a screenshot of the canvas at each size: Pinterest pin 2:3, Etsy 4:3, Etsy 1:1 (the size
   select is in the top bar), and one with two layouts.
3. Check by eye: the two pages behind show a clear band of their top (navigation / hero) above the
   front page; the front page's shadow separates it from them; nothing touches the canvas edges at
   the top or sides.
4. If a band is under about 3% of the canvas height or the pages behind are hard to tell apart, adjust
   `peek` and `shrink` in `STACK` only (keep the tests passing), and say what you changed.

Attach or describe the screenshots in your report. If you cannot run a browser, say so; the owner
reviews the look before merging.

**Verify**: screenshots exist or the report states they could not be taken.

### Step 6: Docs

`CLAUDE.md`, the `lib/arrange.ts` bullet: after the `spotlight` entry add
`` `stack` Stack, one page in front and the others behind it, each narrower and higher; ``.

**Verify**: `grep -n "stack" CLAUDE.md` → 1 match.

## Test plan

Unit: Step 3 (the updated name test plus 9 new cases). E2E: Step 4 (two expectations). No golden
changes. Preview/export parity is unaffected (no rendering code changes).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `describe('stack')` exists with at least 9 tests
- [ ] `git diff --stat 0cab4ee -- lib/render components` prints nothing (no rendering or component change)
- [ ] `grep -n "showsWholePages = " lib/arrange.ts` shows the line unchanged (`a === 'showcase' || a === 'columns'`)
- [ ] `git status --short` lists only the five in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated, saying whether the look was checked in a browser

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code.
- After Step 2, a test other than the preset name list fails.
- A golden test fails in CI because of this change (it would mean an existing fixture's positions
  moved, which this plan must not do).
- Making Stack work seems to need a change in `components/` or `lib/render/`.
- The typecheck names a `Record<Arrangement, …>` table outside the in-scope files; report the file.

## Maintenance notes

- A short front page with long pages behind it leaves the pages behind visible below it. That is
  accepted for now; if it looks wrong in practice, cap the pages behind at the front page's bottom
  with a free-height crop (`lib/crop.ts`).
- The layout thumbnails panel now draws one more preset per edit; see the backlog item on thumbnail
  cost in `plans/README.md`.
- Variations (`lib/variations.ts` `RECIPES`) could offer a Stack take; left out so Variations' six
  takes and their tests don't change here.
- Reviewer: check dragging and selecting a page behind works (click its visible band), and that
  switching 3 → 1 layouts and back gives the Scroll and then the Stack again.
