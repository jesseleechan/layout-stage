# Plan 005: The editor says so when the browser can't save

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
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- lib/images.ts lib/store.ts`
> Plans 001 and 002 change `lib/store.ts` (`showProject`, `init`) before this one; those changes are
> expected. For `persist`, `ingest` (in `lib/store.ts`) and `save`, `putImage`, `StoredImage`,
> `ingestImage` (in `lib/images.ts`), compare the "Current state" excerpts against the live code; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (lands cleanly after 001 and 002; different functions)
- **Category**: bug
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

Everything the editor keeps lives in the browser's IndexedDB: each image (stored at up to about
33 megapixels, twelve per project) and the canvas autosave on every undo step. When a write fails
(storage full, or blocked by the browser) the code swallows the error. The image keeps working from
memory for the session, the Projects list even shows a fresh "saved" time, and after a reload the
layouts are blank and the edits are gone. The user is never told. Only "save style" reports blocked
storage today. After this plan the first failed save in a session shows one toast, so the user can
export before closing the tab.

## Current state

- `lib/images.ts` — image blobs in IndexedDB; `save`, `putImage`, `ingestImage`.
- `lib/store.ts` — the editor store; `persist` (autosave), `ingest` (every image added goes through it),
  `toast`.
- `lib/projects/local.ts` — `saveOpenProject(doc): Promise<boolean>` already resolves `false` when
  the canvas write failed (read only; no change needed).

`lib/images.ts:59-75`:

```ts
async function save(key: string, blob: Blob): Promise<void> {
  try {
    const s = db();
    if (s) await set(key, blob, s);
  } catch {
    /* storage blocked or full: the in-memory copy still works for this session */
  }
}

/** Stores a blob as it is and returns its id. */
export async function putImage(blob: Blob): Promise<string> {
  const id = newId();
  fresh.add(id);
  blobs.set(id, blob);
  await save(id, blob);
  return id;
}
```

`lib/images.ts:342-347` and the two returns of `ingestImage` (`:373-374`, `:379-384`):

```ts
export interface StoredImage {
  id: string;
  /** Natural size of the stored image. */
  nw: number;
  nh: number;
}
...
      const el = await loadImage(id);
      return el && { id, nw: el.naturalWidth, nh: el.naturalHeight };
...
  const id = await putImage(blob);
  entries.set(id, { url, img, p: Promise.resolve(img) });
  emit();
  // The thumbnail needs a full decode: it's made in the background, and a panel asking for it waits.
  trackThumb(id, makeThumb(id, blob, img));
  return { id, nw, nh };
```

`lib/store.ts:252-257` — the autosave result is dropped:

```ts
export const useEditor = create<EditorState>()((set, get) => {
  /** Autosave: stores the last undo step (never a half-finished drag) as soon as it's saved, as the
   *  open project's canvas (lib/projects/local.ts). */
  const persist = () => {
    if (autosave) void saveOpenProject(history.current);
  };
```

`lib/store.ts:283` and `:299-310`:

```ts
  const toast = (msg: string) => set({ toast: { id: ++toastSeq, msg } });
...
  const ingest = async (img: NewImage): Promise<MediaItem | null> => {
    if (!isImageFile(img.blob)) {
      toast(NOT_IMAGE);
      return null;
    }
    const got = await ingestImage(img.blob);
    if (!got) {
      toast(`Couldn’t read ${img.name || 'that image'}.`);
      return null;
    }
    return { imageId: got.id, name: img.name || 'Pasted image', source: img.source, nw: got.nw, nh: got.nh };
  };
```

Module-level state in `lib/store.ts:220-225` (where a new flag belongs):

```ts
let history = new History(defaultComposition());
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
let autosave = false; // on once the saved canvas has been read
let toastSeq = 0;
let jobSeq = 0;
let initStarted = false;
```

The existing wording for blocked storage, `lib/store.ts:622`:

```ts
      toast(ok ? `Saved “${st.name}”.${note}` : `Added “${st.name}” for this session. This browser blocked storage, so it won’t be kept.`);
```

Facts: `autosave` only becomes `true` inside `init()`, which no existing unit test calls, so existing
unit tests never reach `saveOpenProject`. Unit tests mock `@/lib/images` and their `ingestImage`
mocks return `{ id, nw, nh }` with no extra field (see `tests/unit/store-media.test.ts:7-12`), so the
new field must be optional and only an explicit `false` may warn.

Conventions: short plain comments; 2-space indent, single quotes, semicolons; typographic apostrophes
(’) and quotes (“ ”) in user-facing text, as in the excerpts.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/store-storage.test.ts` | passes |

## Scope

**In scope**:

- `lib/images.ts` (`save`, `putImage`, `StoredImage`, `ingestImage`, one new module-level `Set`)
- `lib/store.ts` (`persist`, `ingest`, one flag, one helper)
- `tests/unit/store-storage.test.ts` (create)

**Out of scope** (do NOT touch):

- `lib/projects/local.ts`, `lib/persist.ts` — `saveOpenProject` already reports failure.
- `lib/projects/library.ts` — sync's handling of images it can't find is unchanged.
- Thumbnail saves (`save(THUMB + id, …)`) — a lost thumbnail is remade; no warning for those.
- Any attempt to free space, retry, or estimate quota (`navigator.storage`) — not in this plan.
- Other callers of `putImage` in the repo — they keep working unchanged (its signature stays).

## Git workflow

- Branch: `advisor/005-storage-failure-warning`
- Commit message style from `git log`: plain sentence. Suggested:
  `Say so when the browser can't save an image or the canvas`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The image store reports a failed write

In `lib/images.ts`:

- Make `save` resolve to a boolean:

  ```ts
  async function save(key: string, blob: Blob): Promise<boolean> {
    try {
      const s = db();
      if (!s) return false;
      await set(key, blob, s);
      return true;
    } catch {
      return false; // storage blocked or full: the in-memory copy still works for this session
    }
  }
  ```

- Near the other module-level maps, add `/** Images whose blob couldn't be stored: they last for this session only. */ const unsaved = new Set<string>();`
- In `putImage`: `if (!(await save(id, blob))) unsaved.add(id);` in place of `await save(id, blob);`.
- In `StoredImage` add `/** False when the browser couldn't store it: it is gone after a reload. */ stored?: boolean;`
- In `ingestImage`, both successful returns add `stored: !unsaved.has(id)` (the first becomes
  `return el && { id, nw: el.naturalWidth, nh: el.naturalHeight, stored: !unsaved.has(id) };`).
- Other `save(...)` call sites (thumbnails) keep ignoring the result; they compile unchanged.

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 2: One warning per session in the store

In `lib/store.ts`:

- Add to the module-level state: `let storageWarned = false; // one warning per session`
- Inside the `create` callback, after `toast` is defined, add:

  ```ts
  /** The browser couldn't store an image or the canvas: said once, so the work can be exported first. */
  const warnStorage = () => {
    if (storageWarned) return;
    storageWarned = true;
    toast('This browser couldn’t save your work (its storage is full or blocked). It’s safe while this tab stays open: export what you need before closing it.');
  };
  ```

  `persist` is defined above `toast` in the file; move `toast` (and `warnStorage`) above `persist`, or
  define `persist` after them. Do not change what any of them do.
- `persist`:

  ```ts
  const persist = () => {
    if (autosave) void saveOpenProject(history.current).then((ok) => { if (!ok) warnStorage(); });
  };
  ```

- `ingest`: after the `if (!got) { ... }` block add `if (got.stored === false) warnStorage();`

**Verify**: `npm run typecheck` → exit 0; `npm test` → all existing tests pass unchanged.

### Step 3: Tests

Create `tests/unit/store-storage.test.ts` as in "Test plan".

**Verify**: `npx vitest run tests/unit/store-storage.test.ts` → passes; `npm test` → all pass.

## Test plan

`tests/unit/store-storage.test.ts`. The warning flag is module state, so each test needs a fresh
store: `vi.resetModules()` in `beforeEach`, then `const { useEditor } = await import('@/lib/store');`
inside the test. Mocks (hoisted, with switches the tests flip):

```ts
const io = vi.hoisted(() => ({ saveOk: true, stored: true as boolean | undefined, n: 0 }));
vi.mock('@/lib/images', () => ({
  ingestImage: async () => ({ id: `img_${++io.n}`, nw: 1440, nh: 4000, ...(io.stored === undefined ? {} : { stored: io.stored }) }),
  loadImage: async () => null,
  releaseImage: () => {},
  pruneImages: async () => {},
}));
vi.mock('@/lib/projects/local', () => ({
  openStartupProject: async () => ({ ok: true, doc: null }),
  saveOpenProject: async () => io.saveOk,
  localImageIds: async () => null,
}));
vi.mock('@/lib/persist', async (orig) => ({ ...(await orig<typeof import('@/lib/persist')>()), loadStyles: async () => [], saveStyles: async () => true }));
```

A tick helper: `const settle = () => new Promise((r) => setTimeout(r, 0));`

Cases:

1. *Autosave works: no warning.* `io.saveOk = true`; `await S().init(); await settle();` → `S().toast` is null.
2. *Autosave fails: one warning.* `io.saveOk = false`; `await S().init(); await settle();` →
   `S().toast?.msg` matches `/couldn’t save/`. Then `useEditor.setState({ toast: null })`, make a
   change that commits: `S().setCount(S().doc.count === 1 ? 2 : 1)` (`setCount` is a discrete action
   that saves an undo step and so autosaves), `await settle()` → `S().toast` is still null (said once).
3. *An image that couldn't be stored warns.* `io.saveOk = true; io.stored = false`; `await S().init()`;
   `await S().landMedia({ blob: new Blob(['x'], { type: 'image/png' }), name: 'a.png', source: { kind: 'file' } })`
   → the toast matches `/couldn’t save/`.
4. *An image store that says nothing doesn't warn.* `io.stored = undefined` → after `landMedia` the
   toast does not match `/couldn’t save/`.

Model the store-driving style on `tests/unit/store-media.test.ts`.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including `tests/unit/store-storage.test.ts` (4 tests)
- [ ] `grep -n "void saveOpenProject(history.current);" lib/store.ts` returns no matches
- [ ] `grep -c "warnStorage" lib/store.ts` prints `3` (the definition and the two call sites, in `persist` and `ingest`)
- [ ] `git status --short` lists only the three in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (beyond Plans 001/002's expected changes).
- Any existing unit test starts showing the new toast (it would mean a test reaches `saveOpenProject`
  after all; report which one instead of weakening the warning).
- `vi.resetModules()` plus dynamic import doesn't give a fresh `storageWarned` (cases 1 and 2
  interfere): report it; do not export a reset function from the store just for tests.

## Maintenance notes

- The Projects list still shows a fresh time after a failed save (`saveOpenProject` updates the list
  entry either way). Making that honest is a follow-up in `lib/projects/local.ts`.
- When storage is blocked from the start, the warning appears on the first change after load; that is
  intended.
- Reviewer: check the toast appears once per page load, and that Plan 002's "couldn’t be read" toast
  and this one can't fire for the same event.
- Possible follow-up: ask for persistent storage (`navigator.storage.persist()`) and show usage.
