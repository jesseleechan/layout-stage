# Plan 006: CI can't go green with the browser tests skipped, and the goldens job keeps its token to itself

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9e6961d..HEAD -- tests/unit/capture-browser.test.ts tests/unit/site-pages.test.ts .github/workflows/update-goldens.yml`
> Plan 004 adds tests near the top of `tests/unit/site-pages.test.ts`; that is expected. For the
> `hasBrowser` blocks and the workflow, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW for the tests; MED for the workflow (it can only be proven by running it on GitHub)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `9e6961d`, 2026-11-15

## Why this matters

1. The only tests that drive the real capture browser through the address guard (the protection that
   stops captures from reaching private network addresses) skip themselves when Playwright's Chromium
   isn't found. A skipped suite is green. If a Playwright bump or a CI change ever makes the browser
   go missing, the most security-relevant tests in the repo stop running and nobody notices.
2. The "Update goldens" workflow has permission to push to the repo. It checks out with the default
   settings, which leave that write token in `.git/config` while `npm ci`, `next build` and the test
   run execute dependency and branch code. The regular CI workflow already avoids this
   (`persist-credentials: false`); this one should too, with the token used only by the final push.

## Current state

- `tests/unit/capture-browser.test.ts`, `tests/unit/site-pages.test.ts` — Vitest files with a
  browser-backed `describe` each.
- `.github/workflows/ci.yml` — sets nothing special, but GitHub Actions always sets `CI=true`.
- `.github/workflows/update-goldens.yml` — manual workflow that regenerates golden PNGs and pushes.

`tests/unit/capture-browser.test.ts:14-20` and `:148` (the same block is at
`tests/unit/site-pages.test.ts:77-83` and `:115`):

```ts
const hasBrowser = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
...
describe.skipIf(!hasBrowser)('capture in a real browser (offline)', () => {
```

`.github/workflows/ci.yml:39-45` — CI installs the browser before the unit tests for exactly this reason:

```yaml
      # Before the unit tests: the capture tests drive a real Chromium (and skip without one).
      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Unit tests
        run: npx vitest run
```

`.github/workflows/ci.yml:25-28` — the pattern to copy:

```yaml
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
```

`.github/workflows/update-goldens.yml:10-12`, `:27` and `:50-66`:

```yaml
permissions:
  contents: write # push the regenerated PNGs
  actions: write # start CI on the new commit (a push made with GITHUB_TOKEN starts no workflow)
...
      - uses: actions/checkout@v7
...
      - name: Commit and push changed goldens
        env:
          BRANCH: ${{ github.ref_name }}
          GH_TOKEN: ${{ github.token }}
        run: |
          git add tests/e2e/__golden__
          if git diff --cached --quiet; then
            echo "The goldens already pass on CI's runner; nothing to commit." | tee -a "$GITHUB_STEP_SUMMARY"
            exit 0
          fi
          git diff --cached --stat | tee -a "$GITHUB_STEP_SUMMARY"
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git commit -m 'Regenerate golden PNGs on CI' \
            -m "Regenerated on the GitHub Actions runner (ubuntu-24.04) by the Update goldens workflow, run $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID."
          git push origin "HEAD:refs/heads/$BRANCH"
          gh workflow run ci.yml --ref "$BRANCH"
```

Facts: the GitHub-hosted runner has the `gh` CLI. `gh auth setup-git` configures git to use `gh` as
its credential helper, and `gh` reads the token from the `GH_TOKEN` environment variable, which this
step already sets. With `persist-credentials: false` the checkout leaves no token in `.git/config`,
so `git push` needs that helper.

Conventions: workflow comments are full sentences explaining why (see the excerpts). Test files keep
helpers at module level above the `describe`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass (browser suites pass or show as skipped) |
| The guard, forced | `CI=1 npx vitest run tests/unit/capture-browser.test.ts tests/unit/site-pages.test.ts` | see Step 1 |
| YAML check | `node -e "const y=require('fs').readFileSync('.github/workflows/update-goldens.yml','utf8'); if(/\t/.test(y)) throw new Error('tab in yaml'); console.log('ok')"` | prints `ok` |

Do not run `npx playwright install` (CLAUDE.md lists it as a once-per-machine step for people; some
environments ship their own Chromium and a second install breaks them).

## Scope

**In scope**:

- `tests/unit/capture-browser.test.ts`
- `tests/unit/site-pages.test.ts`
- `.github/workflows/update-goldens.yml`

**Out of scope** (do NOT touch):

- `.github/workflows/ci.yml` — its triggers, order and Node version are a separate decision
  (see `plans/README.md`). Exception: none.
- `tests/unit/zip.test.ts` (skips without `python`/`unzip`) and `tests/e2e/projects.spec.ts` (skips
  when sync is off) — those skips are about optional local tools and stay.
- `playwright.config.ts`, golden PNGs, anything under `tests/e2e/`.
- Pinning actions to commit SHAs — worthwhile, but needs the SHAs looked up; not in this plan.

## Git workflow

- Branch: `advisor/006-ci-hardening`
- Two commits, one per concern. Message style from `git log`: plain sentence. Suggested:
  `CI: the browser-backed capture tests fail instead of skipping` and
  `Update goldens: the push token is only there for the push`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: In CI, a missing browser is a failure

In both test files, directly after the `hasBrowser` block, add:

```ts
// CI installs Chromium before the unit tests (.github/workflows/ci.yml): there, a missing browser is
// a broken setup, not a reason to skip the only tests that drive the real browser through the guard.
if (process.env.CI && !hasBrowser) throw new Error('Playwright’s Chromium is missing: run `npx playwright install chromium` before the unit tests.');
```

Leave `describe.skipIf(!hasBrowser)` as it is (local runs without a browser still skip).

**Verify**:

- `npm run typecheck` → exit 0.
- `npm test` (no `CI` variable; if your shell has `CI` set, run `env -u CI npm test`) → all pass.
- Then check which case you are in: `node -e "const {chromium}=require('playwright');console.log(require('fs').existsSync(chromium.executablePath()))"`.
  - Prints `false` (no browser here): `CI=1 npx vitest run tests/unit/site-pages.test.ts` must **fail**
    with the message above. That failure is the expected result of this step.
  - Prints `true`: `CI=1 npx vitest run tests/unit/capture-browser.test.ts tests/unit/site-pages.test.ts`
    must pass with **no** skipped tests in those two files.

### Step 2: The goldens workflow keeps no token on disk

In `.github/workflows/update-goldens.yml`:

- Change the checkout step to:

  ```yaml
      # No token left in .git/config while npm ci, the build and the tests run the branch's code; the
      # last step signs in for its push.
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
  ```

- In the last step's `run:` script, add `gh auth setup-git` on its own line immediately before
  `git push origin "HEAD:refs/heads/$BRANCH"`. Change nothing else in that script.

**Verify**: the YAML check command prints `ok`;
`grep -n "persist-credentials: false" .github/workflows/update-goldens.yml` → 1 match;
`grep -n "gh auth setup-git" .github/workflows/update-goldens.yml` → 1 match, on the line before `git push`.

### Step 3: Hand the workflow check to the operator

This workflow can only be proven on GitHub. In your report, tell the operator: after merging (or on
the branch), run **Actions → Update goldens → Run workflow** once on a branch. Expected: it ends green
with either "nothing to commit" or a pushed commit followed by a CI run. If the push step fails with
an authentication error, revert the two workflow edits (the test change stands on its own).

**Verify**: nothing to run; the note must be in your report and in the `plans/README.md` status row.

## Test plan

No new test files. The guard itself is verified by the forced `CI=1` run in Step 1. CI on GitHub is
the real check: the "Unit tests" step must still pass and its log must show the two browser suites
running, not skipped.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `env -u CI npm test` exits 0
- [ ] The Step 1 forced run behaves as described for your case (state which case in the report)
- [ ] `grep -c "process.env.CI && !hasBrowser" tests/unit/capture-browser.test.ts tests/unit/site-pages.test.ts` → `1` for each file
- [ ] `grep -c "persist-credentials: false" .github/workflows/update-goldens.yml` → `1`
- [ ] `git status --short` lists only the three in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated, noting the workflow still needs one manual run on GitHub

## STOP conditions

Stop and report back (do not improvise) if:

- The `hasBrowser` blocks or the workflow don't match the excerpts.
- With a browser present, the forced `CI=1` run shows failing (not skipped) capture tests: that is a
  real, pre-existing failure the skip was hiding. Report the test names and output; do not fix them
  here.
- You are tempted to edit `ci.yml` to make something pass.

## Maintenance notes

- Any new test that needs the real browser should reuse this guard so CI can't skip it.
- If the goldens workflow is later split into a read-only build job and a small commit job, the
  `contents: write` permission can move to the commit job alone.
- Deferred (see `plans/README.md`): CI runs Node 22 while Vercel runs Node 24; a push to a PR branch
  starts two CI runs; Playwright's browser download and `.next/cache` aren't cached; actions are
  pinned by major tag, not SHA.
