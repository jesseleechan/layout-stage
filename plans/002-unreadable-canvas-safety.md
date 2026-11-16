# Plan 002: A canvas that can't be read is never overwritten, and can't stall sync

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
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- lib/persist.ts lib/projects/local.ts lib/projects/library.ts lib/store.ts`
> Plan 001 lands first and changes `lib/projects/local.ts` (adds `switchOpenProject`),
> `lib/projects/library.ts` (`show`, `create`, `pull`) and `lib/store.ts` (`showProject`). Those changes
> are expected. For the functions this plan touches (`sanitizeComposition`, `readDoc`,
> `openStartupProject`, `localImageIds`, the `syncAll` loop, `init`), compare the "Current state"
> excerpts against the live code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-project-switch-integrity.md (same files; land it first to avoid conflicts)
- **Category**: bug
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

Two failure paths around stored canvases lose work or lock the app up:

1. **Startup overwrites an unreadable project.** If the open project's canvas can't be read from
   IndexedDB at startup (a read error, or stored data the sanitizer rejects), the code treats it like
   a brand-new empty project: it saves the default canvas over it and then deletes that project's
   images as "unused". That is permanent, silent data loss. With sync off every project is always
   `dirty`, which is the branch that does this.
2. **One malformed canvas throws.** `sanitizeComposition` only checks three slot fields. A slot with
   no `source` makes it throw a `TypeError`. At startup nothing catches it, so the editor never
   finishes loading. In sync, the throw aborts the whole sync round, which retries forever and never
   reaches the other projects.

After this plan: an unreadable canvas is left exactly as stored and another project opens instead;
the sanitizer repairs or rejects but never throws; one failing project no longer blocks the rest of a
sync round.

## Current state

Files:

- `lib/persist.ts` — IndexedDB key/value helpers and `sanitizeComposition`.
- `lib/projects/local.ts` — `readDoc`, `openStartupProject`, `localImageIds`.
- `lib/store.ts` — `init()` (startup), which calls `openStartupProject` and prunes images.
- `lib/projects/library.ts` — `syncAll`, the sync round.
- `lib/media.ts` — `mediaItemOf`, `addMedia`, `keepShownInMedia` (where the throw happens; read only).

`lib/persist.ts:27-35` — a read error and "nothing stored" look the same:

```ts
/** Generic key/value access to the app's IndexedDB store (e.g. recent capture URLs). */
export async function getValue<T>(key: string): Promise<T | undefined> {
  try {
    const s = db();
    return s ? ((await get(key, s)) as T | undefined) : undefined;
  } catch {
    return undefined;
  }
}
```

`lib/persist.ts:58-66` and `:83-84` — the sanitizer's checks, and the call that can throw:

```ts
/** Fills in anything missing from an older or partial save; rejects anything unusable. */
export function sanitizeComposition(raw: unknown): Composition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Composition>;
  if (!(typeof r.W === 'number' && typeof r.H === 'number' && r.W > 0 && r.H > 0)) return null;
  if (!Array.isArray(r.slots) || r.slots.length !== 3) return null;
  if (!r.slots.every((s) => s && typeof s.imageId === 'string' && s.nw > 0 && s.nh > 0)) return null;
  const d = defaultComposition();
  const out: Composition = {
  ...
  // The gallery came later: the layouts' images join it (addMedia drops it when empty).
  keepShownInMedia(out);
```

`lib/media.ts:19-21` and `:46-47` — `source` is dereferenced (`clone(undefined)` is `undefined`):

```ts
export const mediaItemOf = (s: Pick<Slot, 'imageId' | 'name' | 'source' | 'nw' | 'nh'>): MediaItem => ({
  imageId: s.imageId, name: s.name, source: clone(s.source), nw: s.nw, nh: s.nh,
});
...
  for (const it of items) {
    if (isSampleId(it.imageId) || it.source.kind === 'sample' || list.some((m) => m.imageId === it.imageId)) continue;
```

The slot source type, `lib/model.ts:21-24`:

```ts
export type SlotSource =
  | { kind: 'sample' }
  | { kind: 'file' }
  | { kind: 'url'; url: string; capturedAt: string; options: CaptureOptions; needsPassword?: boolean }; // the password itself is never stored
```

`lib/projects/local.ts:84` — `readDoc` returns `null` for missing, unreadable and rejected alike:

```ts
export const readDoc = async (id: string): Promise<Composition | null> => sanitizeComposition(await getValue(K_DOC + id));
```

`lib/projects/local.ts:111-147` — startup. Note `(!doc && !cur.dirty)`: a dirty project with no
readable doc falls through and returns `{ ok: true, doc: null }`:

```ts
export async function openStartupProject(): Promise<{ ok: boolean; doc: Composition | null }> {
  const legacy = await loadComposition();
  if (!legacy.ok) return legacy;
  let idx = sanitizeIndex(await getValue(K_INDEX));
  if (!idx) { ... first run: migrates the old single autosave ... }
  state = idx;
  let doc: Composition | null = null;
  const cur = idx.items.find((p) => p.id === idx!.currentId && !p.stub);
  if (cur) doc = await readDoc(cur.id);
  if (!cur || (!doc && !cur.dirty)) {
    // The open project is gone or was never downloaded: open the latest one there is, else a new one.
    const recent = [...idx.items].filter((p) => !p.stub).sort((a, b) => b.updatedAt - a.updatedAt);
    let found: LocalProject | null = null;
    for (const p of recent) {
      doc = await readDoc(p.id);
      if (doc) { found = p; break; }
    }
    if (!found) {
      doc = null;
      found = await addLocalProject({ id: newProjectId(), name: untitledName(idx.items.map((p) => p.name)), blank: true }, null);
    }
    await updateLocal((s) => { s.currentId = found!.id; });
  }
  return { ok: true, doc };
}
```

A project legitimately has no stored doc when it was just created blank:
`addLocalProject({ ..., blank: true }, null)` (line 140 above). That case must keep working.

`lib/projects/local.ts:168-181` — the open project's missing doc is skipped when collecting images to keep:

```ts
  for (const p of state.items) {
    if (p.stub) continue;
    const doc = await readDoc(p.id);
    if (!doc) {
      if (p.id === state.currentId) continue; // the open canvas is `also`
      return null;
    }
```

`lib/store.ts:357-384` — `init()`: with `ok && !saved` it saves the default canvas and prunes:

```ts
      const [loaded, styles] = await Promise.all([openStartupProject(), loadStyles()]);
      const saved = loaded.doc;
      ...
      // A failed read isn't a first run: keep the stored canvas and images untouched.
      if (loaded.ok) {
        if (!saved) persist();
        // Every project in this browser keeps its images (null: a canvas couldn't be read, prune nothing).
        void localImageIds(referencedIds(get().doc)).then((keep) => keep && pruneImages(keep));
      }
```

`lib/projects/library.ts:489-541` — one `try` around the whole plan; any throw skips the remaining items:

```ts
      try {
        for (const a of plan) {
          if (a.kind !== 'push' && a.kind !== 'adopt' && a.kind !== 'thumb' && a.kind !== 'refresh') setPhase('syncing');
          switch (a.kind) {
            case 'delete': ...
            case 'pull':
              await pull(a.id, a.remote);
              break;
            ...
          }
        }
        // Deleted here and already gone from the store.
        ...
        synced();
      } catch (e) {
        failed(e);
      }
```

`failed` (`library.ts:302-311`) sets the phase to `offline` for `api.OfflineError`, else `error`, and
schedules a retry with backoff. `isBusyError` (`library.ts:82`) is true for an `AbortError`.

Conventions to match: short plain comments above the code; 2-space indent, single quotes, semicolons;
no linter. Toast wording in this app is plain and specific (see the toasts in the excerpts).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| One file | `npx vitest run tests/unit/<file>` | that file passes |

Do not run the e2e suite for this plan; CI runs it.

## Scope

**In scope**:

- `lib/persist.ts`
- `lib/projects/local.ts`
- `lib/projects/library.ts` (the `syncAll` loop only)
- `lib/store.ts` (`init()` only)
- `tests/unit/persist-sanitize.test.ts` (create)
- `tests/unit/projects-local-startup.test.ts` (create)

**Out of scope** (do NOT touch):

- `lib/media.ts` — the gallery helpers assume a sanitized doc; fix the input, not them.
- `lib/projects/server/api.ts` — server-side canvas validation stays loose on purpose (old clients).
- Validation of slot numbers (`cx`, `cy`, `w`, `fx`, `fy`) or `crop` — tightening those could reject
  canvases saved by older versions. Not in this plan.
- `getValue` — other callers rely on its "undefined on any failure" behavior. Add a new function.

## Git workflow

- Branch: `advisor/002-unreadable-canvas-safety`
- Commit message style from `git log`: `Projects sync: fix refused project updates and the 30-second retry loop`.
  Suggested: `Projects: a canvas that can't be read is left alone, and can't stall sync`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The sanitizer repairs a slot's source and never throws

In `lib/persist.ts`:

1. Rename the existing function body to a private `function sanitize(raw: unknown): Composition | null`
   (keep its doc comment on the exported wrapper).
2. Inside it, after `out` is built and **before** `keepShownInMedia(out);`, add:

   ```ts
   // A layout without a usable source (a hand-edited or damaged save) counts as an uploaded file.
   for (const s of out.slots) {
     const src = s.source as Partial<Extract<SlotSource, { kind: 'url' }>> | { kind?: unknown } | null | undefined;
     const ok = !!src && typeof src === 'object' && (src.kind === 'sample' || src.kind === 'file' ||
       (src.kind === 'url' && typeof (src as { url?: unknown }).url === 'string' && !!(src as { options?: unknown }).options && typeof (src as { options?: unknown }).options === 'object'));
     if (!ok) s.source = { kind: 'file' };
     if (typeof s.name !== 'string') s.name = '';
   }
   ```

   (Import `type SlotSource` from `./model`. Simplify the casts if you can keep `npm run typecheck`
   clean; the behavior above is what matters.)
3. Export the wrapper:

   ```ts
   /** Fills in anything missing from an older or partial save; rejects anything unusable (never throws). */
   export function sanitizeComposition(raw: unknown): Composition | null {
     try {
       return sanitize(raw);
     } catch {
       return null;
     }
   }
   ```

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 2: Tell "nothing stored" from "couldn't be read"

In `lib/persist.ts`, next to `getValue`, add:

```ts
/** Like getValue, but says whether the read worked: `ok` is false when storage is missing or the read
 *  failed, so a caller doesn't mistake that for nothing being stored. */
export async function readValue<T>(key: string): Promise<{ ok: boolean; value: T | undefined }> {
  try {
    const s = db();
    if (!s) return { ok: false, value: undefined };
    return { ok: true, value: (await get(key, s)) as T | undefined };
  } catch {
    return { ok: false, value: undefined };
  }
}
```

In `lib/projects/local.ts`, add next to `readDoc` (keep `readDoc` as it is for its other callers):

```ts
/** A project's stored canvas, and why there is none: `missing` (never stored: a new blank project) or
 *  `unreadable` (the read failed, or what is stored isn't a usable canvas). */
export async function readStoredDoc(id: string): Promise<{ doc: Composition | null; state: 'ok' | 'missing' | 'unreadable' }> {
  const r = await readValue(K_DOC + id);
  if (!r.ok) return { doc: null, state: 'unreadable' };
  if (r.value === undefined) return { doc: null, state: 'missing' };
  const doc = sanitizeComposition(r.value);
  return doc ? { doc, state: 'ok' } : { doc: null, state: 'unreadable' };
}
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Startup leaves an unreadable project alone

In `lib/projects/local.ts` `openStartupProject`:

- Change the return type to `Promise<{ ok: boolean; doc: Composition | null; skipped?: string }>`
  (`skipped` is the name of a project that couldn't be read).
- Replace `if (cur) doc = await readDoc(cur.id);` and the condition after it with:

  ```ts
  let broken = false;
  if (cur) {
    const r = await readStoredDoc(cur.id);
    doc = r.doc;
    broken = r.state === 'unreadable';
  }
  // The open project is gone, was never downloaded, or can't be read: open the latest one there is,
  // else a new one. One that can't be read stays stored as it is.
  if (!cur || (!doc && (!cur.dirty || broken))) {
  ```

- Leave the fallback loop as it is (its `readDoc` returns `null` for the broken project, so it is
  skipped naturally).
- Change the final return to `return { ok: true, doc, ...(broken && cur ? { skipped: cur.name } : {}) };`

`localImageIds` needs no change: once another project is the open one, the unreadable project is not
`state.currentId`, so its `null` doc makes the function return `null` and nothing is pruned. Confirm
this by reading lines 168-181; do not edit them.

In `lib/store.ts` `init()`, after `set({ savedStyles: styles, hydrated: true });` add:

```ts
      if (loaded.skipped) toast(`“${loaded.skipped}” couldn’t be read in this browser, so another project is open. It hasn’t been changed.`);
```

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 4: One failing project doesn't stop the sync round

In `lib/projects/library.ts` `syncAll`, wrap the body of the `for (const a of plan)` loop (the
`setPhase` line and the `switch`) in its own `try`/`catch`, keeping the outer `try` as it is:

```ts
        let firstError: unknown = null;
        for (const a of plan) {
          try {
            ...existing setPhase line and switch, unchanged...
          } catch (e) {
            // Offline or cancelled: nothing else will work either. Anything else: go on with the rest.
            if (e instanceof api.OfflineError || isBusyError(e)) throw e;
            firstError ??= e;
          }
        }
```

Then, where the loop's `try` block currently ends with `synced();`, use:

```ts
        if (firstError) failed(firstError);
        else synced();
```

(The "Deleted here and already gone from the store" block between the loop and `synced()` stays where
it is and runs either way.)

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 5: Tests

Create the two test files in "Test plan".

**Verify**: `npx vitest run tests/unit/persist-sanitize.test.ts tests/unit/projects-local-startup.test.ts` → pass; `npm test` → all pass.

## Test plan

`tests/unit/persist-sanitize.test.ts` (pure; import `sanitizeComposition` from `@/lib/persist` and
`defaultComposition` from `@/lib/arrange`, `clone` from `@/lib/model`; structure like
`tests/unit/media.test.ts`):

1. A valid canvas round-trips: `sanitizeComposition(clone(defaultComposition()))` is not null.
2. A slot with no `source` (`delete (d.slots[1] as { source?: unknown }).source`) does not throw; the
   result is not null and `result.slots[1].source` equals `{ kind: 'file' }`.
3. A slot whose source is `{ kind: 'url' }` with no `url`/`options` becomes `{ kind: 'file' }`.
4. A valid `url` source (`{ kind: 'url', url: 'https://example.com', capturedAt: '2026-10-01T00:00:00.000Z', options: DEFAULT_CAPTURE }`,
   `DEFAULT_CAPTURE` from `@/lib/model`) is kept as `kind: 'url'`.
5. Garbage never throws and gives null: `null`, `'x'`, `{}`, `{ W: 1000, H: 1500, slots: [1, 2, 3] }`,
   `{ W: 1000, H: 1500, slots: [{}, {}, {}] }`.
6. A canvas whose `media` is a number (`d.media = 5 as never`) does not throw (null or a canvas, either is fine).

`tests/unit/projects-local-startup.test.ts` — mock storage with a `Map` and fresh module state per
test. If Plan 001's `tests/unit/projects-local-switch.test.ts` exists, copy its mock block and add
`readValue`; otherwise use:

```ts
const mem = vi.hoisted(() => ({ map: new Map<string, unknown>(), failKeys: new Set<string>() }));
vi.mock('@/lib/persist', async (orig) => ({
  ...(await orig<typeof import('@/lib/persist')>()),
  getValue: async (k: string) => (mem.failKeys.has(k) ? undefined : mem.map.get(k)),
  readValue: async (k: string) => (mem.failKeys.has(k) ? { ok: false, value: undefined } : { ok: true, value: mem.map.get(k) }),
  setValue: async (k: string, v: unknown) => { mem.map.set(k, v); return true; },
  deleteValue: async (k: string) => mem.map.delete(k),
  loadComposition: async () => ({ ok: true, doc: null }),
  saveComposition: async () => true,
}));
```

`beforeEach`: clear both, `vi.resetModules()`, and `await import('@/lib/projects/local')` inside each
test. Seed the index directly:
`mem.map.set('projects', { v: 1, currentId: 'p_a', items: [{ id: 'p_a', name: 'Shop', createdAt: 1, updatedAt: 2, rev: null, dirty: true }, { id: 'p_b', name: 'Other', createdAt: 1, updatedAt: 1, rev: null, dirty: true }], pendingDeletes: [] })`
and docs under `'project:p_a'` / `'project:p_b'`.

Cases:

1. *Readable*: both docs valid → returns `p_a`'s doc, no `skipped`, `currentId` stays `p_a`.
2. *Stored but not a canvas* (`'project:p_a'` = `{ nope: true }`, dirty) → returns `p_b`'s doc,
   `skipped === 'Shop'`, `currentId === 'p_b'`, and `mem.map.get('project:p_a')` is still `{ nope: true }`.
3. *Read fails* (`mem.failKeys.add('project:p_a')` with a valid doc stored) → same as case 2, and the
   stored value is untouched.
4. *New blank project* (no `'project:p_a'` key at all, dirty) → returns `{ ok: true, doc: null }` with
   no `skipped` and `currentId` still `p_a` (today's behavior for a fresh project must not change).
5. *Nothing pruned after a skip*: after case 2, `await L.localImageIds([])` is `null`.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including the two new files (11 new tests)
- [ ] `grep -n "catch" lib/persist.ts` shows a `try/catch` inside `sanitizeComposition`
- [ ] `grep -n "readStoredDoc" lib/projects/local.ts` shows the definition and its use in `openStartupProject`
- [ ] `git status --short` lists only the six in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (beyond Plan 001's expected changes).
- Test case 4 (a new blank project) can't be made to pass together with cases 2–3: the
  missing/unreadable distinction is the point of the plan.
- Any existing test in `tests/unit/` fails after Step 1 (a fixture relied on a source the new check
  replaces; report the fixture rather than loosening the check).
- You find yourself wanting to edit `lib/media.ts` or `lib/projects/server/api.ts`.

## Maintenance notes

- The unreadable project stays in the list. Opening it from the Projects sheet tries the synced copy
  (if sync is on) or says it can't be opened; it is never overwritten. A "repair / delete" affordance
  is a possible follow-up.
- New required fields on `Slot` should get a default or repair in `sanitize`, not a rejection, so
  older saves keep opening.
- Reviewer: check the blank-project path (`addLocalProject(..., null)`) still opens as an empty canvas,
  and that `failed()` is still called once per sync round at most.
- Deferred: validating slot numbers and `crop` in the sanitizer; server-side canvas validation.
