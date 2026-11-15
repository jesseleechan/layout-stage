# Plan 007: The pin text travels with the exported images

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cab4ee..HEAD -- lib/pin-text.ts components/ExportSheet.tsx tests/unit/pin-text.test.ts tests/e2e/output.spec.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `0cab4ee`, 2026-11-15

## Why this matters

The editor already writes a title, description, alt text and destination link for each canvas
("Pin text", in the export sheet), and the user copies the four fields by hand for every pin. The
multi-image exports (All sizes, Variations, the Etsy listing set) produce a ZIP of images only, so
the text for each image has to be recreated or copied one canvas at a time. After this plan each of
those ZIPs also holds one `pin-text.txt` with the text for every image in it, ready to paste when the
pins are scheduled.

## Current state

- `lib/pin-text.ts` — pure text suggestions. `pinTextOf(doc).values` gives the four fields (the user's
  edits where there are any, else the suggestion); `copyAllText(values)` formats them.
- `components/ExportSheet.tsx` — the export sheet and its Zustand store `useExport`; `runMulti` renders
  a list of files and zips them.
- `lib/zip.ts` — `zipBlobs(files: { name: string; blob: Blob }[])`; names must be unique.
- `tests/unit/pin-text.test.ts` — unit tests for the text.
- `tests/e2e/output.spec.ts` — reads the downloaded ZIPs back and asserts their entries.

`lib/pin-text.ts:136-151`:

```ts
/** What each field shows: the user's text where edited, else the suggestion. */
export function pinTextOf(doc: Pick<Composition, 'preset' | 'slots' | 'count' | 'overlays' | 'background' | 'pin'>): { values: PinValues; suggested: PinValues; edited: Record<PinField, boolean> } {
  ...
}

/** All four fields, labelled, for one paste. Empty fields are left out. */
export function copyAllText(v: PinValues): string {
  return PIN_FIELDS.filter((f) => v[f].trim())
    .map((f) => `${PIN_LABELS[f]}: ${v[f].trim()}`)
    .join('\n\n');
}
```

`components/ExportSheet.tsx:125-139` and `:157-168` — `runMulti`'s plan type and the zip step:

```ts
  /** Renders `plan` one file at a time into the open sheet, then zips the files. */
  const runMulti = async (
    mode: MultiMode,
    plan: { key: string; label: string; render(): Promise<HTMLCanvasElement>; name(w: number, h: number): string; doc?: Composition }[],
    zipName: string,
    format: Format,
    returnTo: string,
  ) => {
    ...
    const files = get().items.filter((it) => it.blob).map((it) => ({ name: it.name, blob: it.blob! }));
    try {
      if (files.length) {
        const z = await zipBlobs(files);
        if (id !== runId) return;
        set({ zip: { url: URL.createObjectURL(z), name: zipName, size: z.size } });
      }
    } catch {
      if (id === runId) note('Couldn’t make the zip. Save the files one by one.');
    } finally {
      if (id === runId) set({ rendering: false });
    }
```

Important: the existing optional `doc` on a plan item is copied onto the sheet item and means "this
variation can be put on the canvas" (it shows a button). Do **not** reuse it for the text; add a
separate field.

The three callers, `components/ExportSheet.tsx:203-208`, `:224-229`, `:239-245`:

```ts
      const plan = allSizes(clone(doc)).map((it) => ({
        key: it.key,
        label: it.label,
        render: () => renderComposition(it.doc, exportScale(it.doc.W, it.doc.H, it.scale)),
        name: (w: number, h: number) => exportFileName(it.doc, w, h, format),
      }));
...
      const plan = etsySet(clone(doc)).map((it, i) => ({
        key: it.key,
        label: it.label,
        render: render(it),
        name: (w: number, h: number) => setFileName(i, it.key, w, h, format),
      }));
...
      const plan = pinVariations(snap, pal ? siteBackgrounds(pal) : null, pageMeasure()).map((v, i) => ({
        key: v.key,
        label: v.label,
        doc: v.doc,
        render: () => renderComposition(v.doc, exportScale(v.doc.W, v.doc.H, ui.exportScale)),
        name: ...
      }));
```

Every `etsySet` item has a `doc: Composition` (the first has `key: 'hero'`). `runPagesGrid` (All
pages) is a fourth caller; it gets no text.

`tests/e2e/output.spec.ts:12-29` — `readZip` asserts every entry is a PNG, and `:64-69` / `:81-87`
assert the exact entry lists:

```ts
function readZip(buf: Buffer): { name: string; method: number; w: number; h: number }[] {
  ...
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    expect(buf.readUInt32BE(data)).toBe(0x89504e47); // PNG
    out.push({ name, method: buf.readUInt16LE(p + 10), w: buf.readUInt32BE(data + 16), h: buf.readUInt32BE(data + 20) });
...
    expect(readZip(zip)).toEqual([
      { name: 'layout-stage-pinterest-2000x3000.png', method: 0, w: 2000, h: 3000 },
      { name: 'layout-stage-pinterest-9x16-1080x1920.png', method: 0, w: 1080, h: 1920 },
      { name: 'layout-stage-etsy-4x3-3000x2250.png', method: 0, w: 3000, h: 2250 },
      { name: 'layout-stage-etsy-square-2000x2000.png', method: 0, w: 2000, h: 2000 },
    ]);
```

Conventions: short plain comments above the code; 2-space indent, single quotes, semicolons; no
linter. `lib/` modules marked "Pure" must stay free of DOM and store access.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/pin-text.test.ts` | passes |
| E2E (only if Playwright's Chromium is installed) | `npx playwright test output --trace off` | passes |

If the e2e command can't start a browser, don't install one; say so in your report. CI runs the suite.

## Scope

**In scope**:

- `lib/pin-text.ts`
- `components/ExportSheet.tsx` (`runMulti` and its three callers named above)
- `tests/unit/pin-text.test.ts`
- `tests/e2e/output.spec.ts`

**Out of scope** (do NOT touch):

- `lib/zip.ts`, `lib/sets.ts`, `lib/variations.ts` — the image lists and file names stay as they are.
- `runPagesGrid` (All pages) and the single-image export — no text file for those.
- The text templates in `suggestPinText` — wording is not part of this plan.
- A Pinterest bulk-upload CSV — it needs publicly hosted image URLs, which the app doesn't have.

## Git workflow

- Branch: `advisor/007-pin-text-in-exports`
- Commit message style from `git log`: plain sentence, e.g. `A switch to turn URL capture off (NEXT_PUBLIC_CAPTURE=off)`.
  Suggested: `Export: the zips carry the pin text for each image (pin-text.txt)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: A pure function that writes the text file

In `lib/pin-text.ts`, after `copyAllText`, add:

```ts
/** The text file that goes into a multi-image export's zip. */
export const PIN_TEXT_FILE = 'pin-text.txt';

/** The pin text for each exported image, under its file name: one block per image, a line of dashes
 *  between them. Images whose text is the same share one block, listed together. */
export function pinTextFile(entries: { file: string; doc: Parameters<typeof pinTextOf>[0] }[]): string {
  const blocks: { files: string[]; text: string }[] = [];
  for (const e of entries) {
    const text = copyAllText(pinTextOf(e.doc).values);
    const same = blocks.find((b) => b.text === text);
    if (same) same.files.push(e.file);
    else blocks.push({ files: [e.file], text });
  }
  return blocks.map((b) => `${b.files.join('\n')}\n\n${b.text}`).join('\n\n----------\n\n') + '\n';
}
```

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Put it in the zips

In `components/ExportSheet.tsx`:

- Import `pinTextFile` and `PIN_TEXT_FILE` from `@/lib/pin-text`.
- Add an optional field to `runMulti`'s plan item type: `pin?: Composition` with the comment
  `/** The canvas whose pin text goes into the zip's pin-text.txt for this file. */`.
- In `runMulti`, after the `const files = ...` line and before the `try`, add:

  ```ts
    // The pin text for the images that rendered, as one text file beside them.
    const texts = plan.flatMap((p, i) => {
      const it = get().items[i];
      return p.pin && it?.blob ? [{ file: it.name, doc: p.pin }] : [];
    });
    if (texts.length) files.push({ name: PIN_TEXT_FILE, blob: new Blob([pinTextFile(texts)], { type: 'text/plain;charset=utf-8' }) });
  ```

- Callers: in `runAllSizes` add `pin: it.doc,` to each plan item; in `runVariations` add `pin: v.doc,`;
  in `runEtsySet` add `...(it.key === 'hero' ? { pin: it.doc } : {}),` (one block for the listing: the
  hero's text). Leave `runPagesGrid` alone.

The sheet's list of files (`items`) is not changed: the text file exists only inside the zip.

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 3: Unit tests

In `tests/unit/pin-text.test.ts`, add a `describe('pinTextFile', ...)` (import `pinTextFile`,
`PIN_TEXT_FILE`; build docs the way the file's existing tests do):

1. One image: the output starts with the file name, then a blank line, then exactly
   `copyAllText(pinTextOf(doc).values)`, and ends with a newline.
2. Two images with different text (for example the same doc with `preset: 'pin'` and
   `preset: 'etsy43'`, whose suggestions differ): two blocks separated by a line of ten dashes, each
   under its own file name, in input order.
3. Two images with the same text: one block listing both file names on consecutive lines.
4. A field the user edited (`doc.pin = { title: 'My title' }`) appears as `Title: My title`.
5. `PIN_TEXT_FILE` is `'pin-text.txt'`.

**Verify**: `npx vitest run tests/unit/pin-text.test.ts` → passes with 5 more tests.

### Step 4: Update the e2e ZIP checks

In `tests/e2e/output.spec.ts`:

- In `readZip`, treat a `.txt` entry as text: skip the PNG signature check for it and push
  `{ name, method, w: 0, h: 0 }`. Keep the PNG check for every other entry.
- `Export all sizes` test: append `{ name: 'pin-text.txt', method: 0, w: 0, h: 0 }` to the expected list.
- `Etsy listing set` test: append `'pin-text.txt'` to the expected names, and change
  `entries.forEach((e) => expect([e.w, e.h]).toEqual([3000, 2250]));` so it only checks entries whose
  name ends in `.png`.
- Add one assertion in the `Export all sizes` test that the text is really there: find the entry's
  bytes (extend `readZip` to also return `text` for `.txt` entries, read with
  `buf.toString('utf8', data, data + size)` where `size` is the central directory's compressed size at
  `p + 20`) and expect it to contain `'Title: '` and `'layout-stage-pinterest-2000x3000.png'`.

**Verify**: if a browser is available, `npx playwright test output --trace off` → passes. Otherwise
`npm run typecheck` → exit 0 (the spec is type-checked) and note in the report that CI must confirm.

## Test plan

Unit: Step 3 (5 tests, modeled on the existing tests in `tests/unit/pin-text.test.ts`).
E2E: Step 4 updates two existing tests; no new spec file.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with 5 new tests in `tests/unit/pin-text.test.ts`
- [ ] `grep -c "PIN_TEXT_FILE" components/ExportSheet.tsx` ≥ 2 (import and use)
- [ ] `grep -n "pin:" components/ExportSheet.tsx` shows the three callers (All sizes, Etsy set, Variations) and not `runPagesGrid`
- [ ] `grep -n "pin-text.txt" tests/e2e/output.spec.ts` shows both updated tests
- [ ] `git status --short` lists only the four in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated (say whether the e2e spec was run locally or left to CI)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code.
- Another e2e spec asserts the number of entries in a ZIP (search `tests/e2e` for `readZip` and
  `.zip`; at the time of writing only `output.spec.ts` reads ZIP contents). Report it rather than
  editing a file outside the scope.
- `pinTextOf` needs fields the export docs don't have (a type error in Step 2 that can't be solved by
  passing the composition as it is).

## Maintenance notes

- New multi-image exports get the text by adding `pin:` to their plan items.
- If the Etsy set should later carry text per photo (not only the hero's), pass `pin: it.doc` for
  every `composition` item; identical texts collapse into one block already.
- Reviewer: open a downloaded ZIP and check the text reads well, and that "Save all" still works
  when one image failed to render (the text then lists only the files that exist).
