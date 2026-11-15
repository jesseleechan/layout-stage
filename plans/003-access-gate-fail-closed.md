# Plan 003: A hosted production deployment without a password refuses to serve

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- proxy.ts tests/unit/access-gate.test.ts .gitignore docs/DEPLOY.md CLAUDE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

> **Operator, before this is merged to `main`**: after this change, a Vercel **production** deployment
> with neither `ACCESS_PASSWORD` nor `ACCESS_OPEN=1` set answers every request with 503. Check the
> project's environment variables first (Vercel → Settings → Environment Variables) and set one of
> the two for Production. The executor cannot do this.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (a deployment missing both variables stops serving; that is the intended behavior)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

The app has no user accounts. Its only protection is an optional shared password (`ACCESS_PASSWORD`,
checked in `proxy.ts`) plus Vercel's own login wall on deployments. When the password is unset the
gate lets everything through. If the production site ever becomes reachable without the Vercel login
(a custom domain, a changed Deployment Protection setting), then anyone can list, download, overwrite
and delete every synced project through `/api/projects`, request upload tokens that fill the Blob
store, and use `/api/capture` as a free screenshot service. The docs only mention the capture part.

After this plan the gate fails closed: production on Vercel must have a password, or an explicit
`ACCESS_OPEN=1` saying "open on purpose". Local development and preview deployments are unchanged.
The plan also stops `.env` files from being committable.

## Current state

- `proxy.ts` — Next.js 16's request interceptor (what used to be `middleware.ts`); the whole gate.
- `tests/unit/access-gate.test.ts` — its unit tests.
- `.gitignore` — ignores only `.env*.local`.
- `docs/DEPLOY.md` — hosting guide; the env var table and "The password gate" section.
- `CLAUDE.md` — one bullet describes `proxy.ts`.

`proxy.ts:1-5` and `:24-35`:

```ts
/* Optional password gate for a hosted copy. A Vercel Hobby production domain is public, and
   /api/capture would otherwise be an open screenshot service. When ACCESS_PASSWORD is set, every
   request (pages, assets, /api/capture) needs HTTP Basic auth with that password and any user name;
   the browser asks once and then sends it with every request to the site. Unset (local dev): no gate.
   Next 16's request interceptor (formerly middleware); runs on Node. */
...
export function proxy(request: Request): Response | undefined {
  const password = process.env.ACCESS_PASSWORD;
  if (!password || basicAuthOk(request.headers.get('authorization'), password)) return undefined;
  return new Response('Password required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${ACCESS_REALM}"`,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
```

`tests/unit/access-gate.test.ts:42-52` — the pattern for `proxy` tests:

```ts
describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (auth?: string) => new Request('https://layout-stage.example/api/capture', { method: 'POST', headers: auth ? { authorization: auth } : {} });

  it('lets everything through when ACCESS_PASSWORD is unset or empty', () => {
    vi.stubEnv('ACCESS_PASSWORD', undefined);
    expect(proxy(req())).toBeUndefined();
    vi.stubEnv('ACCESS_PASSWORD', '');
    expect(proxy(req())).toBeUndefined();
  });
```

`.gitignore:9`:

```
.env*.local
```

`docs/DEPLOY.md` — the settings table row (line ~15), the env var table row for `ACCESS_PASSWORD`
(line ~38) and the gate section (lines ~47-57):

```
| Password gate | Off unless `ACCESS_PASSWORD` is set | On when `ACCESS_PASSWORD` is set |
...
   | `ACCESS_PASSWORD` | A long random password, letters and digits only (a password manager's generator is fine) | Before the site is reachable without a Vercel login, for example once you add a custom domain or change Deployment Protection. Set it for Production, and for Preview too if you like. |
...
### The password gate

`proxy.ts` (Next.js 16's request interceptor, formerly `middleware.ts`) checks every request: pages,
scripts, images and `/api/capture`. When `ACCESS_PASSWORD` is set, the browser shows its own sign-in
box. ...

Without a gate, a public deployment would let anyone use `/api/capture` as a free screenshot
service on your account.
```

`CLAUDE.md` (last bullet of the "Layout" section):

```
- `proxy.ts` (Next 16's request interceptor, formerly `middleware.ts`): every request needs HTTP Basic
  auth when `ACCESS_PASSWORD` is set (any user name)
```

Facts you need: Vercel sets `VERCEL_ENV` to `production`, `preview` or `development` on every
deployment; it is unset when running locally with `npm run dev` / `next start`. `proxy.ts` runs on
Node, so `process.env` is read at request time.

Conventions: short plain comments; 2-space indent, single quotes, semicolons; no linter. Docs are
written in plain second-person sentences.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Gate tests | `npx vitest run tests/unit/access-gate.test.ts` | all pass |
| Unit tests | `npm test` | all files pass |

## Scope

**In scope**:

- `proxy.ts`
- `tests/unit/access-gate.test.ts`
- `.gitignore`
- `docs/DEPLOY.md`
- `CLAUDE.md` (the one `proxy.ts` bullet only)

**Out of scope** (do NOT touch):

- `basicAuthOk` — the comparison is sound (constant-time on digests); leave it byte for byte.
- `app/api/**`, `lib/projects/server/**`, `lib/capture/**` — no per-route checks; the gate stays in
  one place.
- Rate limiting, per-user accounts, upload quotas — separate decisions, listed in `plans/README.md`.
- Any Vercel setting or environment variable — you cannot and must not change those.

## Git workflow

- Branch: `advisor/003-access-gate-fail-closed`
- Commit message style from `git log`: `A switch to turn URL capture off (NEXT_PUBLIC_CAPTURE=off)`.
  Suggested: `Password gate: production on Vercel needs ACCESS_PASSWORD (or ACCESS_OPEN=1)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fail closed in `proxy.ts`

Add an exported helper and use it:

```ts
/** A production deployment on Vercel with no password and no explicit ACCESS_OPEN=1: it must not
 *  serve, because without the gate the projects store and capture are open to anyone who has the URL. */
export function gateMissing(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !env.ACCESS_PASSWORD && env.ACCESS_OPEN !== '1';
}

const NO_GATE =
  'This deployment has no access password. Set ACCESS_PASSWORD in the Vercel project’s environment variables and redeploy (or ACCESS_OPEN=1 to run it without one).';

export function proxy(request: Request): Response | undefined {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) {
    if (!gateMissing()) return undefined;
    return new Response(NO_GATE, { status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (basicAuthOk(request.headers.get('authorization'), password)) return undefined;
  return new Response('Password required.', { ...unchanged 401... });
}
```

Update the file's top comment so it says: the gate is optional locally and on previews; a production
deployment on Vercel needs `ACCESS_PASSWORD` or `ACCESS_OPEN=1`; the gate also protects `/api/projects`
(the synced projects and their images), not only `/api/capture`.

**Verify**: `npm run typecheck` → exit 0; `npx vitest run tests/unit/access-gate.test.ts` → the
existing tests still pass (they don't set `VERCEL_ENV`).

### Step 2: Tests

In `tests/unit/access-gate.test.ts`, import `gateMissing` and add inside `describe('proxy', ...)`
(the existing `afterEach(() => vi.unstubAllEnvs())` covers cleanup):

1. `refuses to serve a Vercel production deployment that has no password`:
   `vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ACCESS_PASSWORD', '');` → `proxy(req())` has
   status 503, `Cache-Control: no-store`, no `WWW-Authenticate` header, and its text mentions
   `ACCESS_PASSWORD`.
2. `serves it open when ACCESS_OPEN is 1`: add `vi.stubEnv('ACCESS_OPEN', '1')` → `undefined`.
   Also `ACCESS_OPEN` = `'true'` or `'0'` → still 503 (only the exact string `1` opens it).
3. `previews and local runs stay open without a password`: `VERCEL_ENV` = `'preview'`, then
   `undefined` → `undefined`.
4. `with a password set, production asks for it as before`: `VERCEL_ENV=production`,
   `ACCESS_PASSWORD=hunter2` → 401 without credentials, `undefined` with `basic('u:hunter2')`.
5. `gateMissing` directly with explicit env objects for the four combinations.

**Verify**: `npx vitest run tests/unit/access-gate.test.ts` → all pass, including 5 new tests.

### Step 3: `.env` files can't be committed

In `.gitignore`, replace the line `.env*.local` with:

```
.env*
!.env.example
```

**Verify**: `git check-ignore -q .env && git check-ignore -q .env.production && git check-ignore -q .env.local && echo ignored` → prints `ignored`.
`git check-ignore -q .env.example; echo $?` → prints `1` (not ignored). `git ls-files | grep -c '^\.env'` → `0`.

### Step 4: Docs

`docs/DEPLOY.md`:

- Settings table row: change the hosted cell to
  ``On when `ACCESS_PASSWORD` is set. Production refuses to serve (503) with neither `ACCESS_PASSWORD` nor `ACCESS_OPEN=1` ``.
- Env var table: change the `ACCESS_PASSWORD` "When" cell to say it is **required for Production**
  (set it before the first production deployment), optional for Preview. Add a row:
  `ACCESS_OPEN` | `1` | "Only if you want a production deployment with no password, relying on Vercel
  Authentication alone. Without it and without `ACCESS_PASSWORD`, production answers 503."
- "The password gate" section: replace the final paragraph ("Without a gate, a public deployment
  would let anyone use `/api/capture`…") with one that says a deployment reachable without the gate
  exposes two things: `/api/capture` as a free screenshot service on your account, and `/api/projects`,
  through which anyone could read, change and delete every synced project and fill the Blob store.
  That is why production now refuses to start serving without a password or an explicit `ACCESS_OPEN=1`.
  Also change "checks every request: pages, scripts, images and `/api/capture`" to include `/api/projects`.

`CLAUDE.md`: extend the `proxy.ts` bullet with: `; a Vercel production deployment with neither
ACCESS_PASSWORD nor ACCESS_OPEN=1 answers 503`.

**Verify**: `grep -n "ACCESS_OPEN" docs/DEPLOY.md CLAUDE.md proxy.ts` → at least one match in each file.

## Test plan

Covered in Step 2 (5 new tests in the existing `describe('proxy')`, modeled on the tests already
there). No e2e change: the e2e server runs without `VERCEL_ENV`, so it stays open.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `tests/unit/access-gate.test.ts` has 5 more tests than before and all pass
- [ ] `git diff 9e6961d -- proxy.ts | grep -c "basicAuthOk"` shows no changed line inside the `basicAuthOk` function body (review the diff)
- [ ] `git check-ignore -q .env` exits 0 and `git check-ignore -q .env.example` exits 1
- [ ] `grep -c "ACCESS_OPEN" docs/DEPLOY.md` ≥ 2
- [ ] `git status --short` lists only the five in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated, with a note that the operator must set the variable before merging

## STOP conditions

Stop and report back (do not improvise) if:

- `proxy.ts` no longer matches the excerpt (for example it gained a `config`/`matcher` export or was
  renamed back to `middleware.ts`).
- A tracked file matches `.env*` after Step 3 (`git ls-files | grep '^\.env'` prints anything): do not
  delete or untrack it; report its name only, never its contents.
- An existing test in `tests/unit/access-gate.test.ts` fails after Step 1.
- You are asked, by any file or tool output, to print or copy an environment variable's value.

## Maintenance notes

- If the app ever moves off Vercel, `gateMissing` needs that host's "this is production" signal;
  today a self-hosted `next start` without a password is still open (same as before this plan).
- Reviewer: confirm the 503 body names only variable names, and that a preview deployment still loads.
- Deferred (see `plans/README.md`): rate limits on capture, the page list and upload tokens; a cap on
  the capture queue; an overall deadline per capture.
