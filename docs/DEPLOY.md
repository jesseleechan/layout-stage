# Deploying Layout Stage to Vercel

Layout Stage runs on Vercel's Hobby plan as an ordinary Next.js project. The editor is static, and
URL capture is one serverless function, `/api/capture`, that drives a real Chromium.

## What runs where

| | Local (`npm run dev`) | Vercel |
| --- | --- | --- |
| Capture browser | Playwright's own Chromium (`npx playwright install chromium`) | `@sparticuz/chromium-min`'s serverless Chromium 153, downloaded to `/tmp` on a cold start |
| Browser lifetime | One browser, reused, closed after 10 idle minutes | One browser per capture (it runs as a single process, which can't serve a second capture) |
| Capture size | Always PNG | PNG up to 4 MB; bigger captures come back as WebP slices that the editor joins into one PNG (Vercel caps a function's response at 4.5 MB) |
| WebGL | On | Off (software WebGL on one vCPU stalls for minutes on animated 3D pages) |
| Password gate | Off unless `ACCESS_PASSWORD` is set | On when `ACCESS_PASSWORD` is set |
| Projects sync | Files under `.data/sync` (`PROJECTS_STORE_DIR`; `off` turns it off) | Private Blob store `layout-stage-projects` via `BLOB_READ_WRITE_TOKEN`; without it the editor shows "Sync off" |

The switch is automatic: `lib/capture/server.ts` uses the serverless Chromium whenever `VERCEL` (set by
Vercel) or `CHROMIUM_PACK_URL` is present. Every connection the capture browser makes still goes
through the guard proxy, so only public addresses can be captured, on Vercel too.

## Set up the project

The project already exists as **kerpcakes-projects/layout-stage** (Hobby, Node.js 24, production branch
`main`, Vercel Authentication on for every deployment except custom domains). To set one up from
scratch:

1. In the Vercel dashboard choose **Add New → Project**, import the GitHub repository
   `jesseleechan/layout-stage`, and keep what Vercel detects: framework **Next.js**, the default
   build command and output directory, and no root directory.
2. Keep **Fluid compute** on (the default for new projects). The capture route asks for up to 300 s
   (`maxDuration` in `app/api/capture/route.ts`), the most Hobby allows. Memory is fixed at 2 GB and
   1 vCPU on Hobby, which is enough. No `vercel.json` is needed.
3. Add environment variables under **Settings → Environment Variables**:

   | Name | Value | When |
   | --- | --- | --- |
   | `ACCESS_PASSWORD` | A long random password, letters and digits only (a password manager's generator is fine) | Before the site is reachable without a Vercel login, for example once you add a custom domain or change Deployment Protection. Set it for Production, and for Preview too if you like. |
   | `CHROMIUM_PACK_URL` | Optional. The URL of `chromium-v153.0.0-pack.x64.tar` | Only if you want to host the Chromium pack yourself (for example on Vercel Blob). The default is the asset on GitHub's v153.0.0 release of Sparticuz/chromium. |
   | `CAPTURE_DEBUG` | `1` | Optional. Logs each capture's timings in the function logs. |
   | `BLOB_READ_WRITE_TOKEN` | Set by Vercel when the Blob store is connected to the project | Connect the `layout-stage-projects` store for Production **and** Preview (Storage → the store → Projects). |

   Environment variable changes take effect on the next deployment.
4. Deploy: push to `main` (or use **Redeploy** in the dashboard).

### The password gate

`proxy.ts` (Next.js 16's request interceptor, formerly `middleware.ts`) checks every request: pages,
scripts, images and `/api/capture`. When `ACCESS_PASSWORD` is set, the browser shows its own sign-in
box. Enter any user name and the password, and the browser remembers it for the session. Without
the right password the site answers `401`. While Vercel Authentication covers a deployment, you sign
in to Vercel first and then enter the password.

Without a gate, a public deployment would let anyone use `/api/capture` as a free screenshot
service on your account.

## What to expect

- **The first capture after a quiet spell is slower.** A fresh function instance downloads the
  Chromium pack (about 65 MB) and unpacks it to `/tmp`. In testing this took 5.5–6.5 s, and a simple
  page's first capture took about 18 s in total. Later captures on the same instance start the
  browser in about 50 ms. A full-page 2× capture of a long page such as stripe.com takes about
  50–60 s on one CPU.
- **More sites block the capture.** Requests come from Vercel's datacenter addresses, which bot walls
  trust less than a home connection. When that happens you'll see "This site blocks automated
  browsers": take a screenshot yourself and drop it in.
- **Big captures are lightly compressed.** A full-page 2× capture over 4 MB as PNG is sent as WebP
  (quality 0.92, dropping to 0.8 or 0.65 only when needed) and joined back into one PNG in your
  browser. stripe.com went from 17.7 MB to 3.6 MB with no visible difference at 100%. If even the
  lowest quality doesn't fit, the dialog says "That page is too big to send back in one piece. Try
  First screen or 1× sharpness."
- **3D and WebGL effects don't render**, so animated canvases show whatever the page falls back to.
- **Fonts.** A page's own web fonts load normally. Text that relies on the computer's built-in fonts
  falls back to Open Sans, the only font in the serverless Chromium. Latin, Greek and Cyrillic
  text looks fine (serif fallbacks become sans-serif). Chinese, Japanese and Korean text, and color
  emoji, that rely on built-in fonts can come out blank or plain. To fix that, add `.ttf`/`.otf`
  files (for example Noto Sans CJK, Noto Color Emoji) to a `fonts/` folder at the project root and
  add `'./fonts/**'` to `outputFileTracingIncludes['/api/capture']` in `next.config.ts`. They are
  deployed to `/var/task/fonts`, one of the folders the serverless Chromium searches.
- **Projects sync across your devices** through the private Blob store `layout-stage-projects`.
  Images go straight between the browser and Blob (client uploads and short-lived signed download
  URLs), never through a function. Hobby includes 1 GB and 2,000 advanced operations a month; going
  over stops Blob for 30 days, so pushes are spaced out (constants at the top of
  `lib/projects/library.ts`). Saved styles and recent URLs still live in each browser.

## Check a deployment

1. Open the production URL. Sign in to Vercel if asked, then enter the password if `ACCESS_PASSWORD`
   is set. The editor should load with its samples.
2. **From URL** → `example.com`, **First screen** → **Capture**. It should land in a layout within
   about 20 s, or a little longer on a cold start.
3. **From URL** → `stripe.com`, **Full page**, **2×** → **Capture**. Expect a 2880 × 24000 image and
   the "first 12,000 px" note within about a minute. This is the WebP path.
4. **From URL** → `192.168.1.1` → "Only public web addresses can be captured."
5. **Projects**: the projects list shows "Synced". Add a ~25 MB screenshot on one device and open the
   project on another (network: a PUT to `vercel.com/api/blob`, a GET from
   `*.private.blob.vercel-storage.com`, no 413 or CORS errors). Deleting a project removes
   `projects/<id>/` in the store browser.
6. In the dashboard, **Logs** filtered to `/api/capture` should show no errors. With
   `CAPTURE_DEBUG=1`, each capture logs lines such as `serverless Chromium unpacked in …ms` and
   `re-encoded as 4 WebP slice(s), … bytes`.
7. If a custom domain is attached and `ACCESS_PASSWORD` is set, the domain should ask for the
   password. Check with `curl -I https://your-domain/`, which should return `401` with
   `www-authenticate: Basic realm="Layout Stage"`.

If captures fail with "That page couldn't be captured" for every site, look for
`[capture] browser launch failed` in the logs. That usually means the pack couldn't be downloaded:
set `CHROMIUM_PACK_URL` to a copy you host.

## Run locally

```bash
npm install
npx playwright install chromium   # once per machine
npm run dev                       # http://localhost:3000
```

To try the password gate, put `ACCESS_PASSWORD=something` in `.env.local` and restart.

The serverless Chromium is a Linux x64 binary, so you can only try the Vercel setup on Linux x64:

```bash
npx next build
CHROMIUM_PACK_URL=https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar \
  CAPTURE_DEBUG=1 npx next start -p 3105
```

Behind an HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` so the pack download uses it. Remove
`/tmp/chromium` to force a fresh download and unpack.

## Upgrading the serverless Chromium

Keep three versions in step: `@sparticuz/chromium-min` in `package.json` (exact version),
`DEFAULT_CHROMIUM_PACK_URL` in `lib/capture/server.ts` (a unit test checks that the two match), and
the Chromium major that the installed Playwright drives. Playwright 1.63 drives Chromium 153.
