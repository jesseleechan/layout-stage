# Plan 001: Autosaves and captures always land in the project they belong to

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- lib/projects/local.ts lib/projects/library.ts lib/store.ts lib/capture/jobs.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

Layout Stage keeps several projects in the browser and autosaves the open one on every undo step.
Two races can put one project's work into another project:

1. **Autosave during a switch.** When a project is opened, the "open project" id changes first, then
   an IndexedDB write is awaited, and only then does the editor show the new canvas. An autosave
   that fires in that gap (a pending nudge, Alt+wheel or pin-text timer, a slider release) stores the
   *old* canvas under the *new* project's id and marks it changed, so sync then uploads it over the
   other device's copy too.
2. **Captures in flight.** A URL capture takes 20–60 s. Opening another project is refused while one
   runs, but creating a project, a pull from another device, and the fallback after a delete are not,
   so the capture lands in whatever project is open when it finishes.

After this plan, the id and the canvas change in the same tick, and a capture started in one project
is dropped instead of landing in another.

## Current state

Files:

- `lib/projects/local.ts` — projects in IndexedDB; `updateLocal` (queued index writes),
  `saveOpenProject` (the autosave).
- `lib/projects/library.ts` — the `useProjects` Zustand store: `show`, `newProject`, `create`, `open`,
  `pull`.
- `lib/store.ts` — the editor store (`useEditor`): `showProject`, `captureJobs`, `landCapture`.
- `lib/capture/jobs.ts` — `runJob`, `captureSite`: run a capture and land its image.

`lib/projects/local.ts:60-72` — the id changes before the awaited write:

```ts
let writing: Promise<unknown> = Promise.resolve();
/** Changes the list and stores it; changes run one after another. */
export function updateLocal(change: (s: LocalIndex) => void): Promise<boolean> {
  const run = writing.then(async () => {
    if (!state) return false;
    change(state);
    const ok = await setValue(K_INDEX, clone(state));
    emit({ type: 'changed' });
    return ok;
  });
  writing = run.catch(() => undefined);
  return run;
}
```

`lib/projects/local.ts:149-153` — the autosave reads the id when it is called:

```ts
/** Autosave: every undo step of the open project. */
export async function saveOpenProject(doc: Composition): Promise<boolean> {
  if (!state) return saveComposition(doc); // storage couldn't be read at startup
  const id = state.currentId;
  const ok = await writeDoc(id, doc);
```

`lib/projects/library.ts:552-560` — the gap (the `await` sits between the id change and `showProject`):

```ts
  /** Shows a project that's on this device. */
  const show = async (id: string, doc: Composition) => {
    await L.updateLocal((s) => {
      s.currentId = id;
    });
    useEditor.getState().showProject(doc);
    thumbStale = !L.findLocal(id)?.thumbAt;
    if (thumbStale) scheduleThumb();
  };
```

`lib/projects/library.ts:644-649` — `create()` has no capture check:

```ts
    async create() {
      if (get().opening || !index()) return;
      await leaveCurrent();
      await newProject();
      set({ sheetOpen: false });
    },
```

`lib/projects/library.ts:659-662` — `open()` has one (the wording to reuse):

```ts
      if (useEditor.getState().captureJobs.length) {
        toast('Wait for the capture to finish, then switch projects.');
        return false;
      }
```

`lib/projects/library.ts:381-391` — `pull()` shows a canvas from another device in the open project:

```ts
    const isOpen = index()?.currentId === id && !sameCanvas;
    if (isOpen) {
      const lost = await fetchImages(id, f.project.name, doc, f.files, f.project.images);
      if (lost) toast(`${lost === 1 ? 'An image' : `${lost} images`} from another device couldn’t be downloaded.`);
      const now = L.findLocal(id);
      if (!now || now.dirty || index()?.currentId !== id) {
        if (now?.dirty) await fork(id, remote);
        return;
      }
      useEditor.getState().showProject(doc);
    }
```

`lib/store.ts:833-842` — `showProject` leaves `captureJobs` alone:

```ts
    showProject(doc) {
      clearTimeout(nudgeTimer);
      history = new History(doc);
      set({
        doc: clone(doc),
        guides: { gx: null, gy: null },
        ui: { ...get().ui, selected: null, exportScale: PRESETS[doc.preset].scale, showSafeArea: PRESETS[doc.preset].safe === 'etsy' },
      });
      syncHistory();
    },
```

`lib/capture/jobs.ts:32-38` — `runJob` lands on whatever doc is open:

```ts
export async function runJob(job: number, spec: CaptureSpec, how: { keepFraming?: boolean; avoidId?: string | null } = {}): Promise<string | null> {
  try {
    const { blob, trimmed, finalUrl } = await captureUrl(spec.url, spec.options, undefined, spec.auth);
    const st = S();
    // The target layout follows its image, in case layouts were removed or reordered meanwhile.
    const running = st.captureJobs.find((j) => j.id === job);
    const targetId = running && captureJobSlot(st.doc, running) != null ? running.targetId : null;
```

`lib/capture/jobs.ts:167-176` — `captureSite` does the same per page:

```ts
  for (const { url, job } of jobs) {
    const ctl = siteJobs.get(job)!;
    try {
      if (ctl.signal.aborted) {
        stopped++;
        continue;
      }
      const { blob, trimmed, finalUrl } = await captureUrl(url, options, ctl.signal, auth);
      const source: SlotSource = { ... };
      if (await S().landMedia({ blob, name: captureName(finalUrl), source })) {
```

A capture job leaves `captureJobs` only through `endCaptureJob` (in the `finally` blocks above), so
"job no longer in `captureJobs` when its capture returns" can only mean the project changed.

Conventions to match:

- Comments are short, plain sentences above the code, like the ones in the excerpts. No JSDoc tags.
- Code style: 2-space indent, single quotes, semicolons, long lines allowed (~200 columns). There is
  no linter or formatter; copy the surrounding style by hand.
- CLAUDE.md rule: "Switching projects calls `showProject`: it resets history like a reload and is not
  an undo step." Keep that true.
- Unit tests mock the image store; see `tests/unit/store-recapture.test.ts:1-30` for the pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 (`node_modules` is not present in a fresh checkout) |
| Typecheck | `npm run typecheck` | exit 0, no output after the tsc banner |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/<file>` | that file passes |

Do not run `npm run test:e2e` for this plan: it needs a Playwright Chromium that may not be installed,
and CI runs it.

## Scope

**In scope** (the only files you should modify):

- `lib/projects/local.ts`
- `lib/projects/library.ts`
- `lib/store.ts`
- `lib/capture/jobs.ts`
- `tests/unit/projects-local-switch.test.ts` (create)
- `tests/unit/capture-jobs-switch.test.ts` (create)

**Out of scope** (do NOT touch):

- `components/**` — no UI change is needed.
- `lib/projects/model.ts`, `lib/projects/api.ts`, `lib/projects/server/**` — sync rules stay as they are.
- `openStartupProject` in `lib/projects/local.ts` (its `s.currentId = found!.id` is startup, before any
  canvas is shown; Plan 002 changes that function).
- `open()`'s existing capture check and its toast text.

## Git workflow

- Branch: `advisor/001-project-switch-integrity`
- One commit is fine. Message style from `git log`: a plain sentence, area first, e.g.
  `Projects sync: fix refused project updates and the 30-second retry loop`. Suggested:
  `Projects: autosaves and captures stay in the project they started in`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Change the open project and its canvas in one tick

In `lib/projects/local.ts`, directly after `updateLocal`, add:

```ts
/** Makes another project the open one. `show` puts its canvas in the editor and runs in the same tick
 *  as the id change, so an autosave never finds one project's id with another project's canvas. */
export function switchOpenProject(id: string, show: () => void): Promise<boolean> {
  if (!state) {
    show();
    return Promise.resolve(false);
  }
  return updateLocal((s) => {
    s.currentId = id;
    show();
  });
}
```

In `lib/projects/library.ts`, change `show` to use it (nothing may be awaited between the id change
and `showProject`):

```ts
  const show = async (id: string, doc: Composition) => {
    await L.switchOpenProject(id, () => useEditor.getState().showProject(doc));
    thumbStale = !L.findLocal(id)?.thumbAt;
    if (thumbStale) scheduleThumb();
  };
```

**Verify**: `npm run typecheck` → exit 0. `grep -n "s.currentId = id" lib/projects/library.ts` → no matches.

### Step 2: A switch ends the captures in flight

In `lib/store.ts` `showProject`, add `captureJobs: []` to the object passed to `set(...)`, with a
comment such as `// Captures in flight belong to the project being left: their images are dropped (lib/capture/jobs.ts).`

In `lib/capture/jobs.ts` `runJob`, right after the line `const running = st.captureJobs.find((j) => j.id === job);`, add:

```ts
    // Another project was opened meanwhile (store.showProject ends its jobs): this image isn't for it.
    if (!running) return null;
```

In `captureSite`, change the first check in the loop so pages of a left project are skipped without
capturing, and check again after the capture returns:

```ts
      const live = () => S().captureJobs.some((j) => j.id === job);
      if (ctl.signal.aborted || !live()) {
        stopped++;
        continue;
      }
      const { blob, trimmed, finalUrl } = await captureUrl(url, options, ctl.signal, auth);
      if (!live()) {
        stopped++;
        continue;
      }
```

(`continue` inside the `try` still runs the `finally`, which is what the existing code relies on.)

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass (no existing test depends on jobs
surviving `showProject`).

### Step 3: Don't switch under a running capture where it can be avoided

In `lib/projects/library.ts`:

- `create()`: after the first `if (...) return;` line, add the same check `open()` has:

  ```ts
      if (useEditor.getState().captureJobs.length) {
        toast('Wait for the capture to finish, then switch projects.');
        return;
      }
  ```

- `pull()`: change `if (isOpen) {` handling so a pull for the open project waits for a later sync
  while a capture runs. Directly after the `const isOpen = ...` line add:

  ```ts
    // A capture is on its way to this canvas: take the store's copy at the next check instead.
    if (isOpen && useEditor.getState().captureJobs.length) return;
  ```

  Returning here writes nothing, so the next `syncAll` plans the same pull again.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Tests

Create the two test files described in "Test plan".

**Verify**: `npx vitest run tests/unit/projects-local-switch.test.ts tests/unit/capture-jobs-switch.test.ts` → both pass; `npm test` → all pass.

## Test plan

`tests/unit/projects-local-switch.test.ts` — `lib/projects/local.ts` has module state and uses
IndexedDB through `lib/persist.ts`, which does not exist in the node test environment. Mock the
key/value functions with a `Map` and keep the real `sanitizeComposition`:

```ts
const mem = vi.hoisted(() => ({ map: new Map<string, unknown>(), hold: null as Promise<void> | null }));
vi.mock('@/lib/persist', async (orig) => ({
  ...(await orig<typeof import('@/lib/persist')>()),
  getValue: async (k: string) => mem.map.get(k),
  setValue: async (k: string, v: unknown) => { if (k === 'projects' && mem.hold) await mem.hold; mem.map.set(k, v); return true; },
  deleteValue: async (k: string) => mem.map.delete(k),
  loadComposition: async () => ({ ok: true, doc: null }),
  saveComposition: async () => true,
}));
```

In `beforeEach`: `mem.map.clear(); mem.hold = null; vi.resetModules();` then
`const L = await import('@/lib/projects/local');` inside each test (module state must be fresh).

Cases:

1. *The canvas is shown in the same tick as the id change*: `await L.openStartupProject()`; add a
   second project with `L.addLocalProject({ id: 'p_b', name: 'B' }, defaultComposition())`; set
   `mem.hold` to a promise you resolve later; call `const done = L.switchOpenProject('p_b', () => { shown = true; })`;
   `await vi.waitFor(() => expect(L.localIndex()!.currentId).toBe('p_b'))`; assert `shown === true`
   while the write is still held; resolve the hold; `await done`.
2. *An autosave during the held write goes to the new project with the new canvas*: same setup; in
   `show` set a variable `current` to a doc with `W: 1234`; while held, call
   `void L.saveOpenProject(current)`; release; then `expect((await L.readDoc('p_b'))?.W).toBe(1234)`
   and the first project's stored doc is unchanged.
3. *Without an index (storage blocked) the canvas is still shown*: do not call `openStartupProject`;
   `await L.switchOpenProject('x', () => { shown = true; })` resolves `false` and `shown` is true.

`tests/unit/capture-jobs-switch.test.ts` — model the mocks on `tests/unit/store-recapture.test.ts:9-28`
(copy its `vi.mock('@/lib/images', ...)` block). Also mock the capture client so the capture can be
held:

```ts
const cap = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void) }));
vi.mock('@/lib/capture/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/client')>()),
  captureUrl: vi.fn(() => new Promise((res) => { cap.resolve = res; })),
  addRecentUrl: vi.fn(async () => undefined),
}));
```

Cases:

1. *A capture started before a switch is dropped*: load a doc with `useEditor.getState().loadComposition(classicComposition())`
   (`classicComposition` from `tests/unit/helpers.ts`); `const job = S().startCaptureJob('https://example.com', 0)`;
   `const p = runJob(job, { url: 'https://example.com', options: DEFAULT_CAPTURE })`;
   `S().showProject(defaultComposition())`; snapshot `S().doc`; resolve the capture with
   `{ blob: new Blob(['x'], { type: 'image/png' }), trimmed: false, finalUrl: 'https://example.com/' }`;
   `expect(await p).toBeNull()`; the doc equals the snapshot; `S().captureJobs` is empty; `S().canUndo` is false.
2. *Without a switch the capture still lands*: same without `showProject`; `await p` is a string and
   `S().doc.slots[0].imageId` equals it.
3. *`showProject` ends running jobs*: start two jobs, call `showProject`, expect `captureJobs` to be `[]`.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including the two new files (6 new tests)
- [ ] `grep -n "s.currentId = id" lib/projects/library.ts` returns no matches
- [ ] `grep -n "switchOpenProject" lib/projects/library.ts lib/projects/local.ts` shows one definition and one call
- [ ] `git status --short` lists only the six in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code.
- An existing test fails after Step 2 (it would mean something relies on capture jobs surviving a
  project switch; report which test).
- `vi.mock('@/lib/persist', ...)` does not take effect for `lib/projects/local.ts` (the stored map
  stays empty); report it instead of adding a fake IndexedDB dependency. CLAUDE.md: "Ask before adding
  a dependency".
- The fix seems to need a change in `components/**`.

## Maintenance notes

- Anything new that changes `currentId` must go through `switchOpenProject`; a bare
  `updateLocal((s) => { s.currentId = ... })` reopens the race.
- A capture dropped by a switch still runs to the end on the server. Cancelling the request is a
  possible follow-up (`captureUrl` takes an `AbortSignal`; only `captureSite` passes one today).
- Reviewer: check that nothing is awaited inside the `switchOpenProject` callback, and that
  `showProject` still isn't an undo step.
- Not covered here: two tabs of the same browser share one list and the last save wins (documented at
  the top of `lib/projects/local.ts` as a known limit).
