# Plan 009: A project can be downloaded as a file and opened from one

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
> **Drift check (run first)**: `git diff --stat 0cab4ee..HEAD -- lib/zip.ts lib/projects/library.ts components/ProjectsSheet.tsx tests/unit/zip.test.ts`
> Plans 001 and 002 change `lib/projects/library.ts` (`show`, `create`, `pull`, the `syncAll` loop)
> before this one; that is expected. For `duplicate` in `library.ts`, the header and `Card` in
> `ProjectsSheet.tsx`, and `lib/zip.ts`, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive; nothing existing changes behavior)
- **Depends on**: plans/002-unreadable-canvas-safety.md (its sanitizer never throws on a damaged
  canvas, which an opened file can contain); apply after 001 and 002
- **Category**: direction (feature)
- **Planned at**: commit `0cab4ee`, 2026-11-15

## Why this matters

Projects live in one browser's storage. Sync to Vercel Blob is optional, can be switched off, and
stops for 30 days if the free plan's budget is exceeded. With sync off or suspended, clearing site
data or moving to another browser loses every project, and there is no way to hand a project to
someone else or keep a backup of a finished listing. The app can already write ZIP files and already
validates canvases that come from outside (sync). After this plan the Projects sheet has **Download**
on each project (one `.zip` holding the canvas and its images) and **Open file…** to bring one back
as a new project.

## Current state

- `lib/zip.ts` — a ZIP *writer* only (stored entries, no compression): `zipBytes`, `zipBlobs`.
- `lib/projects/model.ts` — pure helpers: `projectImageIds(doc)`, `imageFileName(id, type)`,
  `imageIdOf(fileName)`, `fileType(fileName)`, `IMAGE_FILE_RE`, `cleanName`, `copyName`,
  `newProjectId`, `MAX_IMAGE_BYTES`.
- `lib/projects/local.ts` — `addLocalProject(p, doc)`, `readDoc(id)`, `findLocal(id)`.
- `lib/projects/library.ts` — the `useProjects` store; `duplicate(id)` is the closest existing action.
- `lib/images.ts` — `getImageBlob(id)`, `hasImage(id)`, `storeImage(id, blob)`.
- `lib/persist.ts` — `sanitizeComposition(raw)`: returns a usable canvas or `null`.
- `components/ProjectsSheet.tsx` — the Projects sheet: header with "New project", a `Card` per project
  with Rename / Duplicate / Delete icon buttons.

`lib/zip.ts:1-7` and `:145-156`:

```ts
/* A small ZIP writer for "Save all (.zip)". Entries are stored, not compressed: PNG and JPG are
   compressed already, so deflate would only cost time. Names are UTF-8 (general-purpose flag bit 11).
   No ZIP64, so the archive stays under 4 GiB and 65,535 entries, which a listing set never nears.
   ...
/** A ZIP Blob from Blobs. Reads one file at a time for its CRC; the archive references the original
 *  Blobs rather than copying them into one buffer. */
export async function zipBlobs(files: { name: string; blob: Blob }[], date?: Date): Promise<Blob> {
```

The writer's layout (what a reader must parse): each entry is a 30-byte local header + name + data;
the central directory has 46-byte records + name (compressed size at offset 20, name length at 28,
extra length at 30, comment length at 32, local header offset at 42, method at 10); the archive ends
with a 22-byte end record (signature `0x06054b50`, entry count at offset 10, central directory size
at 12 and offset at 16, comment length 0). The local header has the name length at offset 26 and the
extra length at 28. All little-endian. `tests/e2e/output.spec.ts:13-29` holds a 15-line reader of
exactly this layout that you can use as a reference (do not import from it).

`lib/projects/model.ts:27-44` and `:161-173`, `:177-203`:

```ts
export const IMAGE_FILE_RE = /^(img_[A-Za-z0-9-]{4,80})\.(png|jpg|webp|gif|avif|bmp|svg|img)$/;
/** The file an image is stored as: its id plus an extension for its type. */
export function imageFileName(imageId: string, type: string): string { ... }
/** The image id a file name stores, or null. */
export function imageIdOf(fileName: string): string | null { ... }
/** The content type to serve a stored file with. */
export function fileType(fileName: string): string { ... }
...
/** The images sync carries: stored ones (samples are drawn, never stored). */
export function projectImageIds(d: Composition): string[] {
  return referencedImageIds(d).filter((id) => IMAGE_ID_RE.test(id));
}
...
export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}
/** "Name copy", then "Name copy 2", … */
export function copyName(name: string, names: string[]): string {
```

`lib/projects/library.ts:727-742` — `duplicate`, the pattern for "make a new local project and open it":

```ts
    async duplicate(id) {
      if (get().opening || !index()) return;
      const p = L.findLocal(id);
      const doc = id === index()!.currentId ? useEditor.getState().doc : await L.readDoc(id);
      if (!p || !doc || p.stub) return;
      // Images it has only in the store come first, so the copy can be opened and uploaded.
      if (canSync()) await fetchImages(id, p.name, doc, null, p.remoteImages ?? []).catch(() => 0);
      const thumb = await L.readThumb(id);
      const item = await L.addLocalProject(
        { id: newProjectId(), name: copyName(p.name, get().items.map((x) => x.name)), blank: false, thumbAt: p.thumbAt },
        doc,
      );
      if (thumb) await L.writeThumb(item.id, thumb);
      await get().open(item.id);
      scheduleFlush();
    },
```

In the same file: `const toast = (msg: string) => useEditor.getState().showToast(msg);` (line 80),
`const index = () => L.localIndex();`, and the `ProjectsState` interface (lines ~50-78) lists every action.

`lib/images.ts:480-491`:

```ts
/** Stores a downloaded image under its own id, as it was stored on the device that added it. ... */
export async function storeImage(id: string, blob: Blob): Promise<void> {
```

`components/ProjectsSheet.tsx:106-116` — the header:

```tsx
        <div className="sheet-head">
          <h2 id={`${uid}t`}>Projects</h2>
          <div className="proj-head-actions">
            <button className="btn primary sm" id={`${uid}new`} type="button" disabled={!!opening} onClick={() => void create()}>
              New project
            </button>
            <button className="icon-btn" type="button" aria-label="Close" onClick={closeSheet}>
              ✕
            </button>
          </div>
        </div>
```

`components/ProjectsSheet.tsx:250-255` — an action button on a card (copy this shape):

```tsx
          <button
            className="icon-btn xs" type="button" aria-label={`Duplicate ${p.name}`} title={p.stub ? 'Open it first, then duplicate it' : 'Duplicate'}
            disabled={busy || p.stub} onClick={() => void duplicate(p.id)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">...</svg>
          </button>
```

Facts: image ids are random (`img_` + UUID), so an id that already exists in this browser is the same
image and can be skipped. An opened file is **untrusted input**: its canvas must go through
`sanitizeComposition`, its entry names must match `IMAGE_FILE_RE`, and only images the canvas
references are stored. Node 22 (the test environment) has `Blob`, so `lib/` code that uses `Blob`
can be unit-tested (see `zipBlobs` in `tests/unit/zip.test.ts:140`).

Conventions: short plain comments; 2-space indent, single quotes, semicolons; no linter; typographic
quotes (“ ”, ’) in user-facing text; `lib/projects/model.ts` stays pure. CLAUDE.md: "Ask before
adding a dependency" (none is needed here).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/project-file.test.ts tests/unit/zip.test.ts` | pass |
| Dev server (manual check) | `npm run dev` | serves http://localhost:3000 |

## Scope

**In scope**:

- `lib/zip.ts` (add a reader; the writer is untouched)
- `lib/projects/file.ts` (create)
- `lib/projects/library.ts` (two new actions)
- `components/ProjectsSheet.tsx` (two controls)
- `components/projects.css` or whichever stylesheet already styles `.proj-head-actions` — only if a
  one-line spacing rule is needed; find it with `grep -rn "proj-head-actions" components app`
- `tests/unit/zip.test.ts` (add reader tests)
- `tests/unit/project-file.test.ts` (create)
- `CLAUDE.md` (the `lib/projects/` bullet: mention `file.ts`)

**Out of scope** (do NOT touch):

- The ZIP writer (`ZipWriter`, `zipBytes`, `zipBlobs`) and the export ZIPs.
- Sync (`planSync`, `pushOne`, `pull`, the server routes): an opened project is an ordinary new local
  project, and sync treats it like any other.
- Compressed ZIPs (deflate): the reader accepts stored entries only and rejects anything else.
- Thumbnails in the file: the thumbnail is remade when the project opens.
- Drag-and-drop of a project file onto the editor.

## Git workflow

- Branch: `advisor/009-project-file-download-open`
- Commit per step is fine. Message style from `git log`: `Projects: PROJECTS_SYNC=off keeps projects in the browser, Blob unused`.
  Suggested: `Projects: download a project as a file, and open one`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read a stored ZIP

In `lib/zip.ts`, after `zipBlobs`, add (and extend the file's top comment with one sentence: "and a
reader for archives this writer made"):

```ts
/** The entries of a ZIP whose files are all stored (this module's own archives): each as a slice of
 *  `file`, nothing copied. Throws on anything else: a compressed or encrypted entry, ZIP64, a comment,
 *  a name that is absolute or climbs out, or sizes that don't fit the file. */
export async function readStoredZip(file: Blob): Promise<{ name: string; blob: Blob }[]> {
```

Implementation outline (all reads through `new DataView(await file.slice(a, b).arrayBuffer())`,
little-endian):

1. `file.size >= 22`, and the last 22 bytes start with `0x06054b50` and have comment length 0 (offset 20). Else throw `new Error('not a zip')`.
2. Entry count = u16 at 10 (must equal u16 at 8); central directory size = u32 at 12, offset = u32 at 16;
   `offset + size + 22 === file.size`, else throw.
3. Read the central directory in one slice. For each record: signature `0x02014b50`; method (u16 at 10)
   must be 0 and flags (u16 at 8) must have no bit set other than `0x0800`; compressed size (u32 at 20)
   must equal uncompressed size (u32 at 24); name = UTF-8 of `nameLen` bytes at 46; advance by
   `46 + nameLen + extraLen + commentLen`.
4. Reject a name that is empty, starts with `/`, contains `\`, or has a `..` path segment.
5. For each record read its 30-byte local header at the local offset (u32 at 42): signature
   `0x04034b50`; data starts at `local + 30 + nameLen(u16 at 26) + extraLen(u16 at 28)`; `start + size`
   must be `<=` the central directory offset. The entry's blob is `file.slice(start, start + size)`.
6. Return the entries in directory order.

**Verify**: `npm run typecheck` → exit 0.

Add to `tests/unit/zip.test.ts` a `describe('zip reader', ...)`:

1. Round trip: `zipBytes([{ name: 'a.txt', data }, { name: 'dir/b é.bin', data2 }])` wrapped in a
   `Blob` → `readStoredZip` returns the same names in order and the same bytes
   (`new Uint8Array(await e.blob.arrayBuffer())`).
2. An empty archive (`zipBytes([])`) → `[]`.
3. Rejects: a 10-byte blob; a valid archive with one byte appended; a valid archive whose first
   central record's method is patched to 8 (find the record with the offset from the end record and
   write `8` at `+10`); a valid archive with an entry name patched to start with `/` in the central
   directory.

**Verify**: `npx vitest run tests/unit/zip.test.ts` → passes with 3 more tests (the reject cases may
be one test with several expectations).

### Step 2: Pack and unpack a project (pure)

Create `lib/projects/file.ts`:

```ts
/* A project as one file: a stored ZIP with project.json (the name and the canvas) and the canvas's
   images under images/, named as sync names them. Download keeps a backup or hands a project on;
   Open brings one in as a new project. What a file holds is untrusted: the canvas goes through the
   sanitizer and only images the canvas uses are taken. Pure apart from Blob. */
import type { Composition } from '../model';
import { sanitizeComposition } from '../persist';
import { readStoredZip, zipBlobs } from '../zip';
import { cleanName, fileType, imageFileName, imageIdOf, MAX_IMAGE_BYTES, projectImageIds } from './model';

export const PROJECT_FILE_EXT = '.layoutstage.zip';
const MANIFEST = 'project.json';
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

/** "My shop — pin 2" → "my-shop-pin-2.layoutstage.zip". */
export function projectFileName(name: string): string { ... }

/** The project as a file. `missing` counts images this browser doesn't have (the file is made anyway). */
export async function packProject(name: string, doc: Composition, getBlob: (id: string) => Promise<Blob | null>): Promise<{ file: Blob; missing: number }> { ... }

export interface OpenedProject {
  name: string;
  doc: Composition;
  images: { id: string; blob: Blob }[];
  /** Images the canvas uses that the file doesn't hold. */
  missing: number;
}

/** Reads a project file; null when it isn't one (not a zip of ours, no usable canvas). */
export async function unpackProject(file: Blob): Promise<OpenedProject | null> { ... }
```

Rules:

- `projectFileName`: lower-case the name, replace every run of characters outside `a-z0-9` with `-`,
  trim `-` from both ends, cut to 60 characters, fall back to `project` when empty, append `PROJECT_FILE_EXT`.
- `packProject`: manifest = `JSON.stringify({ app: 'layout-stage', v: 1, name, doc })` as a Blob named
  `project.json` (first entry); then for each id in `projectImageIds(doc)`: `getBlob(id)`; a `null`
  counts as missing; otherwise entry `images/${imageFileName(id, blob.type)}`. Build with `zipBlobs`.
- `unpackProject`: wrap everything in `try { ... } catch { return null; }`. `readStoredZip(file)`;
  find `project.json` (size `<= MAX_MANIFEST_BYTES`, else null); `JSON.parse(await blob.text())`;
  require `app === 'layout-stage'` and `v === 1`; `doc = sanitizeComposition(parsed.doc)`, null → null;
  `name = cleanName(typeof parsed.name === 'string' ? parsed.name : '') || 'Opened project'`.
  Images: for each entry whose name is `images/<base>` (exactly one `/`), `id = imageIdOf(base)`;
  keep it only if `id` is in `projectImageIds(doc)`, its size is `> 0` and `<= MAX_IMAGE_BYTES`, and it
  hasn't been taken already; the blob is `entry.blob.slice(0, entry.blob.size, fileType(base))` (so it
  has the right content type). `missing` = referenced ids with no kept image.

Create `tests/unit/project-file.test.ts` (model on `tests/unit/zip.test.ts` and
`tests/unit/projects-model.test.ts`; build a doc with `defaultComposition()` from `@/lib/arrange` and
give two slots ids like `img_aaaa1111` with `source: { kind: 'file' }`):

1. Round trip: pack with a `getBlob` returning small PNG-typed blobs → `unpackProject` gives the same
   name, a canvas whose slot image ids match, both images with type `image/png` and the same bytes,
   `missing: 0`.
2. `packProject` reports `missing: 1` when `getBlob` returns `null` for one id, and `unpackProject`
   then reports `missing: 1` too.
3. Sample images are not packed: the default canvas (all samples) packs to a file with only
   `project.json` and unpacks with `images: []`, `missing: 0`.
4. Not a project: `unpackProject(new Blob(['hello']))` → `null`; a zip without `project.json` → `null`;
   a zip whose `project.json` has `app: 'other'` → `null`; one whose `doc` is `{}` → `null`.
5. Extra files are ignored: a zip made with `zipBlobs` that also holds `images/img_zzzz9999.png` (an
   image the canvas doesn't reference), `notes.txt` and `images/evil.exe` → only the referenced
   images come back.
6. `projectFileName('My shop — pin 2')` is `'my-shop-pin-2.layoutstage.zip'`; `projectFileName('***')`
   is `'project.layoutstage.zip'`.

**Verify**: `npx vitest run tests/unit/project-file.test.ts` → passes (6 tests); `npm run typecheck` → exit 0.

### Step 3: Two actions in the projects store

In `lib/projects/library.ts`:

- Add to `ProjectsState` (with comments in the file's style):
  `/** The project as a file to save, or null (a stub that isn't on this device). */ download(id: string): Promise<{ file: Blob; name: string } | null>;`
  `/** Opens a project file as a new project. */ openFile(file: Blob): Promise<boolean>;`
- Import `packProject`, `projectFileName`, `unpackProject` from `./file`, and `storeImage` next to the
  existing imports from `../images` (check which of `getImageBlob`, `hasImage` are already imported).
- Implement next to `duplicate`:

  ```ts
    async download(id) {
      const p = L.findLocal(id);
      if (!p || p.stub || !index()) return null;
      const doc = id === index()!.currentId ? useEditor.getState().doc : await L.readDoc(id);
      if (!doc) return null;
      // Images it has only in the store come first, so the file is whole.
      if (canSync()) await fetchImages(id, p.name, doc, null, p.remoteImages ?? []).catch(() => 0);
      const { file, missing } = await packProject(p.name, doc, getImageBlob);
      if (missing) toast(`${missing === 1 ? 'An image isn’t' : `${missing} images aren’t`} on this device, so the file doesn’t have ${missing === 1 ? 'it' : 'them'}.`);
      return { file, name: projectFileName(p.name) };
    },

    async openFile(file) {
      if (get().opening || !index()) return false;
      const got = await unpackProject(file);
      if (!got) {
        toast('That file isn’t a Layout Stage project.');
        return false;
      }
      for (const { id, blob } of got.images) if (!(await hasImage(id))) await storeImage(id, blob);
      const names = get().items.map((x) => x.name);
      const item = await L.addLocalProject(
        { id: newProjectId(), name: names.includes(got.name) ? copyName(got.name, names) : got.name, blank: false },
        got.doc,
      );
      if (got.missing) toast(`${got.missing === 1 ? 'An image is' : `${got.missing} images are`} missing from that file.`);
      const opened = await get().open(item.id);
      scheduleFlush();
      return opened;
    },
  ```

  (`open` refuses while a capture runs and says so; the project is in the list either way.)

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 4: The two controls

In `components/ProjectsSheet.tsx`:

- Header, before "New project": a button `Open file…` (`className="btn sm"`, `disabled={!!opening}`)
  that clicks a hidden `<input type="file" accept=".zip,application/zip" hidden>` held in a `useRef`.
  On change: take `files[0]`, reset the input's `value` to `''` (so the same file can be picked
  again), and `void useProjects.getState().openFile(file)`.
- `Card`, between Duplicate and Delete: an icon button modeled on Duplicate's,
  `aria-label={`Download ${p.name}`}`, `title={p.stub ? 'Open it first, then download it' : 'Download'}`,
  `disabled={busy || p.stub}`. On click:

  ```ts
  const save = async () => {
    const got = await useProjects.getState().download(p.id);
    if (!got) return;
    const url = URL.createObjectURL(got.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = got.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  ```

  Icon (13 × 13, same `svg` attributes as the others plus `strokeLinecap="round"`): a down arrow into a
  tray, e.g. `<path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10" />`.
- The sheet traps focus by querying `button:not(:disabled), input:not(:disabled), …`. A hidden input
  is filtered out by the existing `offsetParent !== null` check; confirm Tab still cycles correctly.

**Verify**: `npm run typecheck` → exit 0. Manual check if you can run a browser (`npm run dev`): open
Projects → Download on a project with an uploaded image → a `.layoutstage.zip` is saved; Open file… →
pick it → a new project named "<name> copy" opens with the same canvas and image. If you cannot run
a browser, say so in the report.

### Step 5: Docs

`CLAUDE.md`, the `lib/projects/` bullet: after the `api.ts` mention add
`` `file.ts` a project as one file (Projects → Download / Open file…; `readStoredZip` in `lib/zip.ts`); ``.

**Verify**: `grep -n "file.ts" CLAUDE.md` → 1 match.

## Test plan

Unit tests in Steps 1 and 2 (zip reader: 3; project file: 6). The store actions and the UI are
checked by hand in Step 4; an e2e test is a follow-up (it needs a download and an upload in
Playwright and `tests/e2e/projects.spec.ts` is already the slowest spec).

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with the new `tests/unit/project-file.test.ts` (6 tests) and 3 more tests in `tests/unit/zip.test.ts`
- [ ] `git diff 0cab4ee -- lib/zip.ts` shows only additions after `zipBlobs` and the top comment (the writer is unchanged)
- [ ] `grep -n "sanitizeComposition" lib/projects/file.ts` → at least 1 match (the opened canvas is sanitized)
- [ ] `grep -n "openFile\|download(" lib/projects/library.ts` shows both in the interface and the implementation
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated, saying whether the manual check in Step 4 was done
- [ ] Your report ends with this reminder for the owner, who asked for it: "Plan 009 is finished.
      The feature suggestions waiting for your decision are in `plans/README.md` under 'Feature
      suggestions': the Looks row, text and logo, batch Etsy sets, a Stack take in Variations, more
      canvas sizes, tilted layouts, and a phone frame."

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002 has not landed (`grep -n "function sanitize(" lib/persist.ts` finds nothing): the opened
  canvas would reach a sanitizer that can throw. `unpackProject`'s `try/catch` covers it, but report
  it so the dependency is known.
- `lib/zip.ts`'s writer layout differs from the description in "Current state" (the reader would be wrong).
- `Blob.prototype.slice`/`arrayBuffer`/`text` are missing in the unit-test environment (Node below 18).
- You find you need a ZIP library or deflate support: that is a new dependency and a different plan.
- The focus trap in the sheet breaks with the hidden file input and can't be fixed inside `ProjectsSheet.tsx`.

## Maintenance notes

- The file format has a version (`v: 1`). A future change to it must keep reading `v: 1`.
- A file made by another tool (a zip re-saved by a file manager, which compresses) is rejected with
  "That file isn’t a Layout Stage project." If that confuses users, the message can say "…or it was
  re-zipped".
- An opened project is `dirty` and syncs like any new project; a large one uploads its images on the
  next push.
- Reviewer: try a file with a huge `project.json`, a file with images not referenced by the canvas,
  and opening the same file twice (second copy gets "… copy").
- Follow-ups: download all projects at once; an e2e test; drag a project file onto the sheet.
