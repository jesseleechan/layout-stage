# Plan 010: Claude can connect to Layout Stage (an MCP server) and build draft projects from page links

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
> **Drift check (run first)**: `git diff --stat 0f0806f..HEAD -- lib/projects/server lib/media.ts lib/arrange.ts lib/capture/server.ts proxy.ts next.config.ts package.json`
> Plans 001–009 change other parts of the repo first; of these paths they touch only `proxy.ts`
> (Plan 003: `gateMissing`, the 503) and `lib/arrange.ts` (Plan 008: the `stack` family). Those are
> expected. For everything quoted in "Current state", compare against the live code; on a mismatch,
> treat it as a STOP condition.

> **Operator, before an executor starts** (the executor cannot do these):
>
> 1. **Three new packages**: `mcp-handler`, `@modelcontextprotocol/server` and `zod` as a direct
>    dependency. **Approved by the owner on 2026-11-16** (CLAUDE.md: "Ask before adding a dependency
>    the handoff doesn't name"). Add them to the approved list in CLAUDE.md's last bullet in Step 7.
> 2. **Projects sync must be on** in production (a Blob store connected, `PROJECTS_SYNC` not `off`).
>    The connector writes projects into the synced store; the editor picks them up from there.
>    **The owner confirmed on 2026-11-16 that sync is on.**
> 3. **Claude Design page links must be reachable without signing in.** The connector gets page
>    images by capturing a URL, exactly as the Capture dialog does. The owner will make the links
>    reachable when the connector is in use; nothing to check before building. (If a capture shows a
>    sign-in page later, see "Maintenance notes".)
> 4. After deployment: create a **Protection Bypass for Automation** secret in Vercel (Settings →
>    Deployment Protection) and set `MCP_TOKEN` for Production, then redeploy. **The owner asked to
>    be reminded of this step**: the executor's report must say so (Step 8). To make the token, run
>    `openssl rand -hex 32` in a terminal, or use a password manager's generator: at least 24
>    characters, letters and digits only (it goes into a URL). The connector URL to paste into Claude
>    is `https://<your-domain>/api/mcp?x-vercel-protection-bypass=<bypass secret>&key=<MCP_TOKEN>`.
>    Treat that URL as a password.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED (new public endpoint; new dependencies; long-running tool calls on a serverless function)
- **Depends on**: plans/003-access-gate-fail-closed.md (edits `proxy.ts` first); otherwise independent
- **Category**: direction (feature)
- **Planned at**: commit `0f0806f`, 2026-11-15

## Why this matters

The shop's site designs already live in Claude Design. Turning one into pins and listing photos
today means opening Layout Stage, capturing each page by hand, picking a canvas size, a layout and a
look, per design. An MCP server lets Claude do the repetitive part: given page links, it captures
them, puts them in a new project with a chosen canvas size, layout preset and look, and saves it to
the synced projects store. The owner opens the project in the editor (it appears in Projects on the
next sync), adjusts it and exports as usual.

This plan is the first version. Claude **builds drafts; it does not render or export images**, and
it cannot see the result (rendering lives in the browser). That keeps the "preview and export render
identically" rule untouched: no rendering code runs on the server. A preview tool is a later plan.

## Current state

What exists and is reused (all server-safe; the unit tests import them in Node):

- `lib/projects/server/store.ts` — `projectStore()` returns the configured store (Vercel Blob or the
  local folder) or `null` when sync is off. The `ProjectStore` interface:

  ```ts
  export interface ProjectStore {
    kind: StoreKind;
    readJson<T>(path: string): Promise<StoredJson<T> | null>;
    writeJson(path: string, data: unknown, ifMatch: string | null): Promise<string>;
    list(prefix: string): Promise<string[]>;
    remove(paths: string[]): Promise<void>;
    directUrl(path: string, fresh: boolean): Promise<string | null>;
    read(path: string): Promise<FileStream | null>;
  }
  ```

  There is **no method that writes a binary file** from the server: the browser uploads images
  straight to Blob. This plan adds one.
- `lib/projects/server/api.ts` — `listProjects(store)`, `readProject(store, id)`,
  `writeProject(store, id, w: ProjectWrite)` (refuses when the stored revision differs from
  `w.baseRev`; returns `{ ok: false, remote }` then), `BadRequest`. `ProjectWrite` is
  `{ baseRev: string | null; name; createdAt; updatedAt; thumbRev: string | null; images: RemoteImage[]; doc: unknown }`.
- `lib/projects/model.ts` — `newProjectId()`, `imageFileName(id, type)`, `imagePath(projectId, fileName)`,
  `projectPath`, `cleanName`, `PROJECT_ID_RE`, `IMAGE_ID_RE`, `RemoteImage { name: string; size: number }`
  (`name` is the image's file name, e.g. `img_….png`).
- `lib/projects/server/blob-store.ts` — the only file that calls `@vercel/blob` on the server
  (`put`, `get`, `list`, `del`). `writeJson` there shows the `put` options in use:

  ```ts
        const r = await put(path, JSON.stringify(data), {
          access: ACCESS,
          contentType: 'application/json',
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          ...(ifMatch ? { ifMatch } : { allowOverwrite: false }),
        });
  ```

- `lib/projects/server/fs-store.ts` — the local store; it has a private helper
  `atomicWrite(p: string, data: string | Buffer)` (line ~57).
- `lib/capture/server.ts` — `captureScreenshot(input: CaptureInput, opts?: CaptureRunOptions): Promise<CaptureResult>`.
  `CaptureInput` is the capture options plus `url` and optional `auth`. `CaptureResult` is
  `{ images: { type: 'image/png' | 'image/webp'; data: Buffer }[]; trimmed: boolean; finalUrl: string }`.
  Without `opts.maxBytes` the result is one PNG. Every connection the capture browser makes goes
  through the address guard (public addresses only). One capture runs at a time per server process.
  On Vercel a capture takes 20–60 s.
- `lib/capture/options.ts` — `parseCaptureRequest(body)` validates a URL and options and throws
  `CaptureError`; `clampOptions(raw)`. `lib/capture/errors.ts` — `CaptureError` (has `.message` fit
  to show a user), `toCaptureError`. `lib/capture/switch.ts` — `captureOn()`.
- `lib/capture/png.ts` — `readPng(buf)` returns `{ width, height, … }`.
- `lib/model.ts` — `PRESETS` (canvas sizes: `pin`, `story`, `etsy43`, `etsy11`, `p45`), `STYLES`
  (nine looks, each `{ name, frame, background }`), `applyStyleTo(doc, style)`, `DEFAULT_CAPTURE`,
  `clone`, the `Composition`, `MediaItem` and `SlotSource` types.
- `lib/arrange.ts` — `defaultComposition()`, `applyArrangement(doc, a, measure)`, `arrange(doc, n, measure)`,
  `presetArrangements(n)`, `ARRANGEMENT_NAMES`, `presetOf`. Pass `null` as the measure on the server.
- `lib/media.ts` — `slotFor(doc, target)` (where a new image goes: the first layout still showing a
  sample, else a new layout, else layout 1), `putImage(doc, i, item)`, `addMedia(doc, items)`, `MAX_MEDIA` (12).
- `lib/canvas-size.ts` — `resizeCanvas(doc, W, H, measure, preset)`.
- `lib/persist.ts` — `sanitizeComposition(raw)`.
- `app/api/capture/route.ts` — the pattern for a route that drives the browser:

  ```ts
  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';
  // …300 s is the Hobby plan's maximum.
  export const maxDuration = 300;
  ```

- `next.config.ts` — routes that drive the browser are listed so their files ship:

  ```ts
  outputFileTracingIncludes: {
    '/api/capture': ['./lib/capture/banners.css', './node_modules/playwright/**/*', './node_modules/playwright-core/**/*'],
    '/api/pages': ['./node_modules/playwright/**/*', './node_modules/playwright-core/**/*'],
  },
  ```

- `proxy.ts` — the password gate. With `ACCESS_PASSWORD` set it answers 401 to any request without
  HTTP Basic credentials, which an MCP client can't send. (Today production runs with `ACCESS_OPEN=1`
  and relies on Vercel Authentication.) `basicAuthOk` there shows the constant-time comparison to
  copy: `timingSafeEqual(sha256(a), sha256(b))`.
- `package.json` — `"overrides": { "zod": "^4.6.6" }` already pins zod 4.

How the editor picks up a project the server wrote: on its next sync the browser lists the store,
adds unknown projects as "On another device" cards, and downloads the canvas and the images named in
`ProjectFile.images` when one is opened. So a project written with `writeProject` plus its image
files under `projects/<id>/images/` needs nothing else.

Vercel's guide for MCP servers in a Next.js App Router app
(https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) installs
`mcp-handler@2.1.1 @modelcontextprotocol/server@2 zod@4` and shows this route shape:

```ts
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const handler = createMcpHandler((server) => {
  server.registerTool(
    'roll_dice',
    { description: 'Roll an N-sided die', inputSchema: z.object({ sides: z.number().int().min(2) }) },
    async ({ sides }) => ({ content: [{ type: 'text', text: `You rolled a ${1 + Math.floor(Math.random() * sides)}!` }] }),
  );
});

export { handler as GET, handler as POST };
```

Read that guide and the installed packages' README and type definitions before writing the route:
these libraries change quickly and the installed version is the authority, not this excerpt.

Vercel's Protection Bypass for Automation accepts the secret as a query parameter
(`?x-vercel-protection-bypass=<secret>`), for clients that can't set headers
(https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

Blob budget (from `lib/projects/server/api.ts:5-8`): the free plan includes 2,000 uploads/lists a
month. A project write is two uploads; an image is one. A three-page draft made by this plan's tools
costs about 13. Keep tools from writing more often than they must.

Conventions: one comment block at the top of each file saying what it is and that it is server
only; short plain comments; 2-space indent, single quotes, semicolons; no linter. Errors shown to a
user are plain sentences. "Nothing big passes through a function (4.5 MB cap)": tool results must be
small text, never image bytes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Add the packages (after approval) | `npm install mcp-handler@2.1.1 @modelcontextprotocol/server@2 zod@^4.6.6` | exit 0; `package.json` and `package-lock.json` change |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | all files pass |
| Build | `npx next build` | exit 0 |
| Dev server | `npm run dev` | serves http://localhost:3000 (local store in `.data/sync`) |

## Scope

**In scope**:

- `package.json`, `package-lock.json` (the three packages)
- `lib/projects/server/store.ts`, `blob-store.ts`, `fs-store.ts` (one new method, `writeFile`)
- `lib/mcp/draft.ts` (create; pure canvas building)
- `lib/mcp/tools.ts` (create; the tools' logic on a store and a capture function)
- `lib/mcp/auth.ts` (create; the token check)
- `app/api/mcp/route.ts` (create)
- `proxy.ts` (let `/api/mcp` through to its own token check)
- `next.config.ts` (ship the browser files with the new route)
- `tests/unit/mcp-draft.test.ts`, `tests/unit/mcp-tools.test.ts`, `tests/unit/mcp-auth.test.ts` (create);
  `tests/unit/projects-server.test.ts` and `tests/unit/access-gate.test.ts` (add cases)
- `docs/DEPLOY.md` (a "Claude connector" section), `CLAUDE.md` (one bullet for `lib/mcp/`)

**Out of scope** (do NOT touch):

- `lib/render/**`, `components/**`, `lib/store.ts` — no rendering on the server, no editor change.
- `lib/capture/**` — captures are called, not changed. No new way to fetch URLs: every page image
  comes from `captureScreenshot`, which is already guarded. Do not add a plain `fetch(url)` of a
  user-supplied address.
- Deleting or renaming projects, changing frames or backgrounds field by field, overlays, exporting
  or previewing images, uploading image bytes — later plans.
- OAuth. The token in the URL is this version's whole access control.
- Any Vercel setting or environment variable.

## Git workflow

- Branch: `advisor/010-claude-connector-mcp`
- Commit per step. Message style from `git log`: plain sentence, e.g.
  `A switch to turn URL capture off (NEXT_PUBLIC_CAPTURE=off)`. Suggested for the last one:
  `A Claude connector (MCP): draft projects from page links`.
- Do NOT push or open a PR unless the operator instructed it.

## The tools (what Claude will see)

Six tools. Names and inputs are part of the plan; descriptions should say plainly what each does and
that the result is a draft the owner opens in the editor.

| Tool | Input | Does | Returns (text) |
|---|---|---|---|
| `list_options` | — | Nothing stored is read | Canvas sizes (`pin`, `story`, `etsy43`, `etsy11`, `p45` with their labels and px), layout preset names per number of layouts (from `presetArrangements` / `ARRANGEMENT_NAMES`), look names (from `STYLES`) |
| `list_projects` | — | `listProjects` | Up to 50 projects, newest first: id, name, last edited (ISO) |
| `get_project` | `project` (id) | `readProject` + `sanitizeComposition` | Name, canvas size, number of layouts, layout preset name, each layout's page (name, URL if captured), pages waiting in Media, background type |
| `create_project` | `name`, `canvas?` (default `pin`), `look?` (a look name) | Writes a new project whose layouts still show the sample pages | The new id and name |
| `add_page` | `project`, `url`, `device?` (`desktop` default, or `phone`), `full_page?` (default true) | Captures the page, stores the image, puts it in the canvas (see Step 3), writes the project | Where it went ("layout 2" or "Media"), the page's size, whether it was trimmed |
| `set_layout` | `project`, `layouts?` (1–3), `layout?` (a preset name, e.g. `Editorial`), `canvas?`, `look?` | Changes any of the four and re-arranges | The canvas as `get_project` describes it |

Every tool result ends with one line: `Open Layout Stage → Projects → “<name>” to see it. I can’t see the image.`

## Steps

### Step 1: Packages

After the operator's approval, run the add command. Do not add anything else.

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass;
`node -e "const p=require('./package.json');console.log(!!p.dependencies['mcp-handler'],!!p.dependencies['@modelcontextprotocol/server'],!!p.dependencies.zod)"` → `true true true`.

### Step 2: The store can write a file

Add to `ProjectStore` in `lib/projects/server/store.ts`:

```ts
  /** Writes a file (an image the server made) if there is none at that path yet. */
  writeFile(path: string, data: Uint8Array, type: string): Promise<void>;
```

- `blob-store.ts`: `await put(path, Buffer.from(data), { access: ACCESS, contentType: type, addRandomSuffix: false, allowOverwrite: false });`
  and treat `lostRace(e)` (the file exists) as success.
- `fs-store.ts`: use the existing `atomicWrite(p, Buffer.from(data))` unless the file exists
  (there is an `exists` helper near line 64).

Add a test to `tests/unit/projects-server.test.ts` (it runs the local store in a temp folder):
`writeFile` then `read` returns the same bytes; a second `writeFile` to the same path keeps the first.

**Verify**: `npm run typecheck` → exit 0; `npx vitest run tests/unit/projects-server.test.ts` → passes.

### Step 3: Building the canvas (pure)

Create `lib/mcp/draft.ts` (top comment: what it is; pure; server and tests). Export:

- `CANVASES`: the ids `['pin', 'story', 'etsy43', 'etsy11', 'p45']` (a `PresetId` subset).
- `newDraft(canvas, lookName?)`: `defaultComposition()`; if `canvas !== 'pin'`,
  `resizeCanvas(doc, PRESETS[canvas].w, PRESETS[canvas].h, null, canvas)`; if `lookName` names a
  `STYLES` entry (case-insensitive), `applyStyleTo(doc, style)`. Unknown look → throw
  `new DraftError('There is no look called “…”. …list the names…')`.
- `addPageTo(doc, item: MediaItem): { where: 'layout'; index: number } | { where: 'media' }`:
  if a visible layout still shows a sample or fewer than three layouts are shown, use
  `slotFor(doc, null)`: `putImage(doc, i, item)`, `if (added) doc.count = i + 1`, then
  `arrange(doc, doc.count, null)` and `addMedia(doc, [item])`; return the layout. Otherwise (three
  real pages already) only `addMedia(doc, [item])` and return `media`. (`slotFor` alone would replace
  layout 1 in that case; a fourth page must wait in Media instead.)
- `setLayout(doc, { layouts?, layout?, canvas?, look? })`: apply in this order: `canvas`
  (`resizeCanvas`), `layouts` (set `doc.count`; a layout coming into view that still shows a sample
  stays a sample), `layout` (find the arrangement whose `ARRANGEMENT_NAMES[a][doc.count]` equals the
  name, case-insensitive, among `presetArrangements(doc.count)`; unknown → `DraftError` listing the
  names offered for that count; then `applyArrangement(doc, a, null)`), `look`. If only `layouts`
  changed, call `arrange(doc, doc.count, null)`.
- `describe(doc, name)`: the text `get_project` returns.
- `class DraftError extends Error {}`.

Every function returns or mutates a doc that still passes `sanitizeComposition`.

Create `tests/unit/mcp-draft.test.ts` (model on `tests/unit/arrange-presets.test.ts` for building
docs; mock nothing, these are pure): a new draft per canvas has that canvas's `W`/`H`/`preset` and
passes `sanitizeComposition`; a look by name changes the background; an unknown look throws
`DraftError`; three `addPageTo` calls on a new `pin` draft fill layouts 1, 2 and 3 (count 2 → 3 on
the third) and a fourth goes to Media with the layouts unchanged; `setLayout` with `layout: 'Bento'`
on three layouts sets `arrangement: 'grid'`; with a name not offered for the count it throws and
lists the offered names; `describe` mentions the canvas label and each page name.

**Verify**: `npx vitest run tests/unit/mcp-draft.test.ts` → passes; `npm run typecheck` → exit 0.

### Step 4: The tools' logic, on any store and any capture function

Create `lib/mcp/tools.ts` (server only). One factory so tests can pass a temp store and a fake capture:

```ts
export interface ToolDeps {
  store: ProjectStore;
  capture(input: CaptureInput): Promise<CaptureResult>;
  now(): number;
}
export function draftTools(deps: ToolDeps): {
  listOptions(): string;
  listProjects(): Promise<string>;
  getProject(id: string): Promise<string>;
  createProject(input: { name: string; canvas?: string; look?: string }): Promise<string>;
  addPage(input: { project: string; url: string; device?: string; fullPage?: boolean }): Promise<string>;
  setLayout(input: { project: string; layouts?: number; layout?: string; canvas?: string; look?: string }): Promise<string>;
};
```

Rules:

- Every function returns the text for Claude. Expected failures (`DraftError`, `BadRequest`,
  `CaptureError`, "no such project", a refused write) are caught at the tool boundary and returned as
  plain sentences; anything else is logged with `console.error('[mcp]', …)` (never with the URL's
  query or any token) and returned as `Something went wrong on the server. Try again in a moment.`
- `createProject`: `id = newProjectId()`; `name = cleanName(input.name)` (empty → error);
  `writeProject(store, id, { baseRev: null, name, createdAt: now, updatedAt: now, thumbRev: null, images: [], doc: newDraft(...) })`.
- `addPage`:
  1. `readProject`; missing → error. `doc = sanitizeComposition(file.doc)`; null → error.
  2. Capture options: `{ ...DEFAULT_CAPTURE, width: device === 'phone' ? 390 : 1440, scale: 1, fullPage }`,
     validated with `parseCaptureRequest({ url, ...options })` (it rejects bad and non-public-looking
     URLs and URLs with credentials). Scale 1 keeps a full page within the editor's stored-image
     budget (`lib/image-sizing.ts`: at most 2880 px wide, 33 MP), so the editor never has to shrink it.
  3. `const { images, trimmed, finalUrl } = await deps.capture(input)`; expect exactly one
     `image/png` (no `maxBytes` is passed); anything else → error.
  4. `{ width, height } = readPng(images[0].data)`; `imageId = 'img_' + randomUUID()`;
     `fileName = imageFileName(imageId, 'image/png')`;
     `await store.writeFile(imagePath(project, fileName), images[0].data, 'image/png')`.
  5. `item = { imageId, name: <host + path of finalUrl, as the editor names captures: see captureName in lib/capture/client.ts; copy its logic into a small local function, do not import the browser module>, source: { kind: 'url', url, capturedAt: new Date(now).toISOString(), options }, nw: width, nh: height }`;
     `addPageTo(doc, item)`.
  6. `writeProject(store, project, { baseRev: file.rev, name: file.name, createdAt: file.createdAt, updatedAt: now, thumbRev: file.thumbRev, images: [{ name: fileName, size: images[0].data.byteLength }], doc })`.
     `{ ok: false }` → return `“<name>” was changed in the editor just now. Run this again.` (the
     image file stays; it is small waste, not corruption).
- `setLayout`: read, sanitize, `setLayout(doc, …)`, write with `baseRev: file.rev`; same refusal message.
- `listProjects` caps at 50 and prints ids, because every other tool takes an id.
- When `captureOn()` is false, `addPage` returns `Capture is switched off on this deployment, so pages can’t be added.`

Create `tests/unit/mcp-tools.test.ts` on `fsStore` in a temp folder (copy the setup from
`tests/unit/projects-server.test.ts:13-25`) with a fake capture returning a tiny valid PNG (build one
with `makeIhdr` / `writePng` from `lib/capture/png.ts`, or keep a 1×1 PNG as a base64 constant) and a
fixed `now`. Cases: create then list shows it; `addPage` three times fills three layouts and stores
three image files (`store.list`), a fourth goes to Media; the stored project passes
`sanitizeComposition` and its `images` list names all files; an unknown project, a bad URL
(`ftp://x`), a capture that throws `new CaptureError('timeout')` and a look that doesn't exist each
return a sentence (no throw) and leave the store unchanged; a write refused because the project
changed between read and write (write it once more in between) returns the "changed in the editor"
sentence; `setLayout` changes the arrangement and the canvas; no tool result contains `img_` bytes or
is longer than 4,000 characters.

**Verify**: `npx vitest run tests/unit/mcp-tools.test.ts` → passes; `npm run typecheck` → exit 0.

### Step 5: The token check

Create `lib/mcp/auth.ts`:

```ts
/** Whether a request may use the MCP endpoint: MCP_TOKEN must be set (else the endpoint is off) and
 *  the request must carry it, as `Authorization: Bearer …` or as `?key=…` (connector URLs can't set
 *  headers). Compared in constant time. */
export function mcpAccess(request: Request, env: Record<string, string | undefined> = process.env): 'ok' | 'off' | 'denied'
```

Use the digest comparison from `proxy.ts` (`timingSafeEqual(sha256(a), sha256(b))`). A token shorter
than 24 characters counts as `off` (a weak token must not open the store).

`tests/unit/mcp-auth.test.ts`: unset or short token → `off`; right token in the header → `ok`; right
token in `?key=` → `ok`; wrong or missing → `denied`; the `x-vercel-protection-bypass` parameter is
ignored by this check.

In `proxy.ts`: when the request's path is `/api/mcp` (exactly, or with a trailing segment the handler
needs; check the handler's routing) **and** `mcpAccess(request) === 'ok'`, return `undefined` before
the password check and before Plan 003's 503. Nothing else in `proxy.ts` changes. Add two cases to
`tests/unit/access-gate.test.ts`: with `ACCESS_PASSWORD` set, a request to `/api/mcp` with the right
MCP token passes without Basic credentials, and one with a wrong token still gets 401.

**Verify**: `npx vitest run tests/unit/mcp-auth.test.ts tests/unit/access-gate.test.ts` → pass.

### Step 6: The route

Create `app/api/mcp/route.ts` (top comment: what it is, the connector URL shape, that results are
small text). `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300`.

- Wrap the handler: `mcpAccess(request)` → `off`: 404 with `The Claude connector is off here.`;
  `denied`: 401; `ok`: continue. `projectStore()` null → the tools answer
  `Projects sync is off on this deployment, so there is nowhere to put a draft.` (register the tools
  anyway so the client sees them).
- Build `draftTools({ store, capture: (i) => captureScreenshot(i), now: Date.now })` and register the
  six tools with `createMcpHandler` / `server.registerTool`, input schemas in zod matching the table
  above (`project` validated with `PROJECT_ID_RE`; `url` a string of at most 2048 characters;
  `layouts` an integer 1–3). Each handler returns `{ content: [{ type: 'text', text }] }`.
- Follow the installed `mcp-handler` version's README for the export shape and any required path
  (some versions want `app/api/[transport]/route.ts`; if so, use that path, keep the endpoint at
  `/api/mcp`, and adjust `proxy.ts`, `next.config.ts` and the docs to match).

`next.config.ts`: add the new route to `outputFileTracingIncludes` with the same three entries as
`/api/capture` (it drives the capture browser and reads `banners.css`).

**Verify**:

- `npm run typecheck` → exit 0; `npx next build` → exit 0 and the route is listed in the build output.
- Local smoke test: `MCP_TOKEN=local-test-token-0123456789abcdef npm run dev`, then

  ```bash
  curl -s -X POST 'http://localhost:3000/api/mcp?key=local-test-token-0123456789abcdef' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

  The response (JSON or an event stream) contains `create_project` and `add_page`. If the handler
  requires an `initialize` call first, send one (see the MCP spec's lifecycle) and then `tools/list`.
  Without `?key=` the same request gets 401; with `MCP_TOKEN` unset it gets 404.
- Call `create_project` through the same endpoint (`"method":"tools/call","params":{"name":"create_project","arguments":{"name":"Smoke test"}}`)
  and confirm `.data/sync/projects/` gains a folder. Delete that folder afterwards.

### Step 7: Docs

`docs/DEPLOY.md`: a section "Claude connector (MCP)" covering: what it does and doesn't do (drafts,
no rendering); it needs projects sync on and capture on; `MCP_TOKEN` (add it to the env var table:
"a long random string; unset = connector off"); creating the Protection Bypass secret; the connector
URL shape; that the URL is a password and how to rotate it (change `MCP_TOKEN`, redeploy, update the
connector); the Blob budget note (about 13 store operations per three-page draft); that each
`add_page` takes 20–60 s on Vercel.

`CLAUDE.md`: a bullet after `lib/projects/`: `` `lib/mcp/` the Claude connector: `draft.ts` pure
canvas building, `tools.ts` the tools on a store and a capture function, `auth.ts` the token check;
route `app/api/mcp/route.ts`. Drafts only: nothing renders on the server. ``

**Verify**: `grep -n "MCP_TOKEN" docs/DEPLOY.md CLAUDE.md proxy.ts lib/mcp/auth.ts` → at least one match in `docs/DEPLOY.md` and `lib/mcp/auth.ts`.

### Step 8: Hand over to the operator

In your report, give the operator the checklist from the top of this plan (item 4) and open it with
this reminder, which the owner asked for: "Reminder: set `MCP_TOKEN` in Vercel for Production now
(generate it with `openssl rand -hex 32`, or a password manager: 24+ letters and digits), create the
Protection Bypass secret, and redeploy. The connector stays off until `MCP_TOKEN` is set." Then give
this acceptance test to run in Claude after deploying: add the connector URL as a custom connector, then
ask: "Use Layout Stage to make a Pinterest pin project called Test from https://example.com". Expected:
Claude calls `create_project` and `add_page`, and within a few minutes the project appears in the
editor's Projects sheet as "On another device" and opens with the captured page.

**Verify**: the checklist and the acceptance test are in the report.

## Test plan

Unit: `mcp-draft` (pure canvas building), `mcp-tools` (the tools on a temp local store with a fake
capture), `mcp-auth`, plus added cases in `projects-server` (`writeFile`) and `access-gate` (the
`/api/mcp` exemption). The protocol wiring is covered by the curl smoke test in Step 6; the real
connector by the operator's acceptance test in Step 8. No e2e spec in this plan.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, including the three new test files
- [ ] `npx next build` exits 0
- [ ] The Step 6 curl checks behave as described (tools listed with the key; 401 without; 404 with no token set)
- [ ] `git diff --stat 0f0806f -- lib/render components lib/store.ts lib/capture` prints nothing
- [ ] `grep -rn "fetch(" lib/mcp app/api/mcp` prints nothing (pages come only through `captureScreenshot`)
- [ ] `grep -rn "maxBytes" lib/mcp` prints nothing and no tool returns image data
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated, with what the operator still has to do

## STOP conditions

Stop and report back (do not improvise) if:

- You need a package other than the three approved ones.
- The installed `mcp-handler` / `@modelcontextprotocol/server` API differs from the excerpt in a way
  the README doesn't resolve, or the packages need a zod version the repo's override can't satisfy.
- `next build` fails because of the new packages (bundling, ESM/CJS).
- `captureScreenshot` without `maxBytes` returns something other than one PNG.
- Any step seems to need rendering on the server, a change in `lib/capture/`, or a plain `fetch` of
  a user-supplied URL.
- The smoke test shows the handler needs session state that a serverless function can't keep (for
  example it requires Redis for the transport you are using): report what it asked for.

## Maintenance notes

- **Claude can't see the result.** The natural next plan is a `preview` tool: the capture browser
  opens the deployed editor, loads the project and returns a small JPEG. It needs the app to load
  itself through Vercel's protection (`VERCEL_AUTOMATION_BYPASS_SECRET` is available to the
  deployment) and through the capture guard, and a cold browser start per call. Spike it before
  promising it.
- **Pages that need a sign-in** (if Claude Design links turn out to be private): the fix is an upload
  path, not a guard exception. Vercel Blob client-upload tokens (already used by the editor, see
  `handleClientUpload` in `lib/projects/server/blob-store.ts`) let a client send image bytes straight
  to the store; a `request_upload` tool could hand Claude a one-time upload target. Image bytes must
  never pass through a tool call (far too large) or through a function (4.5 MB cap).
- The connector URL is a bearer credential for the whole projects store. Anyone with it can create
  and change projects (not delete: there is no delete tool). Rotate `MCP_TOKEN` if it leaks.
- Each `add_page` holds a function open for the length of a capture; captures run one at a time, so
  Claude adding several pages waits in line. If that proves too slow, `add_pages` can take a list and
  run them in one call (still under the 300 s limit: about four pages on Vercel).
- A draft written while the same project is open and edited in a browser shows up there as a sync
  conflict copy ("… (this device)"), which is the existing behavior for two devices.
- Reviewer: read `app/api/mcp/route.ts` and `proxy.ts` for anything that answers without checking the
  token; check logs never include the request URL (it carries the token).
