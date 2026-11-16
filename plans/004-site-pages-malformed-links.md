# Plan 004: One badly escaped link no longer breaks whole-site capture

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
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- lib/capture/pages.ts tests/unit/site-pages.test.ts`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

Whole-site capture reads a site's menu and sitemap and offers a list of pages. Building that list
decodes every link's path with `decodeURI` / `decodeURIComponent`, which throw `URIError` on a stray
`%` (for example a sale page at `/50%-off`, common on shop sites). Nothing catches it, so a single
such link anywhere in the menu or sitemap turns the whole request into a 500 and the user sees "That
page couldn't be captured" for a site that is fine. After this plan such a link is listed with its
raw path instead.

## Current state

- `lib/capture/pages.ts` — pure functions that turn a scan (menu links, other links, sitemap URLs)
  into the page list. `sitePages` is called by `app/api/pages/route.ts`.
- `tests/unit/site-pages.test.ts` — its tests (the `describe('sitePages', ...)` block at the top is
  pure and runs without a browser).

`lib/capture/pages.ts:62-70`:

```ts
const key = (u: URL) => `${host(u)}${decodeURI(u.pathname).toLowerCase()}`;

/** "about-us" → "About us"; the root is "Home". */
export function titleFromPath(pathname: string): string {
  const last = decodeURIComponent(pathname.replace(/\/+$/, '').split('/').pop() || '');
  if (!last) return 'Home';
  const words = last.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Home';
}
```

`lib/capture/pages.ts:85-92` — both run for every link, uncaught:

```ts
  const add = (raw: string, text: string, nav: boolean) => {
    if (out.length >= MAX_SITE_PAGES) return;
    const u = pageUrl(raw, base);
    if (!u || seen.has(key(u))) return;
    seen.add(key(u));
    const t = cleanText(text);
    out.push({ url: u.href, title: t && t.length > 1 ? t : titleFromPath(u.pathname), nav });
  };
```

`new URL('https://studio.example/50%-off').pathname` is `/50%-off` (the URL parser keeps a bare `%`),
and `decodeURI('/50%-off')` throws `URIError: URI malformed`.

Test pattern, `tests/unit/site-pages.test.ts:14` and `:57-62`:

```ts
const scan = (patch: Partial<SiteScan> = {}): SiteScan => ({ finalUrl: 'https://studio.example/', nav: [], links: [], sitemap: [], ...patch });
...
  it('names pages from their paths', () => {
    expect(titleFromPath('/')).toBe('Home');
    expect(titleFromPath('/about-us/')).toBe('About us');
    expect(titleFromPath('/shop/linen_dress')).toBe('Linen dress');
    expect(titleFromPath('/caf%C3%A9')).toBe('Café');
  });
```

Conventions: short plain comments; 2-space indent, single quotes, semicolons; small `const` arrow
helpers at module level (like `host`, `cleanText`, `depth` in this file).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| This file's tests | `npx vitest run tests/unit/site-pages.test.ts` | pass (the browser-backed `describe` may show as skipped; that is expected without Playwright's Chromium) |
| Unit tests | `npm test` | all files pass |

## Scope

**In scope**:

- `lib/capture/pages.ts`
- `tests/unit/site-pages.test.ts`

**Out of scope** (do NOT touch):

- `app/api/pages/route.ts`, `lib/capture/server.ts` — the route's error handling is fine once the
  list can't throw.
- `pageUrl`, `SKIP_PATH`, `FILE`, the ordering rules in `sitePages` — behavior for well-formed links
  must not change.

## Git workflow

- Branch: `advisor/004-site-pages-malformed-links`
- Commit message style from `git log`: plain sentence. Suggested:
  `Whole-site capture: a link with a stray % no longer fails the page list`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Decode safely

In `lib/capture/pages.ts`, above `key`, add:

```ts
/** Decodes percent-escapes; a path with a stray "%" (e.g. /50%-off) is used as it is. */
const decoded = (s: string, how: (s: string) => string) => {
  try {
    return how(s);
  } catch {
    return s;
  }
};
```

Change `key` to use `decoded(u.pathname, decodeURI)` and `titleFromPath` to use
`decoded(pathname.replace(/\/+$/, '').split('/').pop() || '', decodeURIComponent)`.

**Verify**: `npm run typecheck` → exit 0. `grep -n "decodeURI" lib/capture/pages.ts` → every match is
either inside `decoded` or passed to it as the second argument.

### Step 2: Tests

In `tests/unit/site-pages.test.ts`, inside `describe('sitePages', ...)`:

- Add to `names pages from their paths`: `expect(titleFromPath('/sale/50%-off')).toBe('50% off');`
- Add a test `keeps going past a link with a stray percent sign`:

  ```ts
  const pages = sitePages(scan({
    nav: [{ href: '/sale/50%-off', text: '' }, { href: '/about', text: 'About' }],
    sitemap: ['https://studio.example/100%', 'https://studio.example/contact'],
  }));
  expect(pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/sale/50%-off', '/about', '/100%', '/contact']);
  expect(pages[1].title).toBe('50% off');
  ```

  (Menu links come first in order; the two sitemap pages are equally shallow, so they keep their
  sitemap order.)
- Add `lists a page once when its escapes differ only in form`:
  `nav: [{ href: '/caf%C3%A9', text: 'Café' }, { href: '/café', text: 'Café' }]` → two entries in
  total (`/` and one café page). This pins the existing de-duplication so the change can't break it.

**Verify**: `npx vitest run tests/unit/site-pages.test.ts` → pass, 2 more tests than before in the
`sitePages` block.

## Test plan

As in Step 2. Model on the existing tests in the same `describe`. `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0
- [ ] `node -e "try{decodeURI('/50%-off')}catch(e){console.log(e.name)}"` prints `URIError` (confirms the premise on this Node)
- [ ] The new test `keeps going past a link with a stray percent sign` exists and passes
- [ ] `git status --short` lists only the two in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code.
- The café de-duplication test fails **before** your change too (then it documents a different,
  pre-existing behavior; drop that one test and say so in your report).
- An existing `sitePages` test changes its result.

## Maintenance notes

- Any new decode of site-provided text in `lib/capture/` should go through the same kind of guard;
  site content is untrusted input.
- Reviewer: the diff should be about ten lines in `pages.ts`.
