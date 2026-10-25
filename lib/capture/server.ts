/* URL capture, driven by Playwright. Locally the browser is Playwright's own Chromium; on Vercel (or
   whenever CHROMIUM_PACK_URL is set) it is @sparticuz/chromium-min's serverless Chromium, which is
   downloaded once per function instance and unpacked to /tmp. This is the only file to change when
   hosting needs a different browser: keep the captureScreenshot() signature, launch the browser
   behind the guard proxy, throw CaptureError. Server only. */
import { open as openFile, readFile, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type LaunchOptions, type Page, type Request as PwRequest } from 'playwright';
import type { CaptureOptions } from '../model';
import { redactAuth, type CaptureAuth } from './auth';
import { authError, navError, pageError } from './detect';
import { CaptureError, NOT_FOUND_MESSAGE, SCHEME_MESSAGE } from './errors';
import { startGuardProxy, type GuardProxy } from './guard-proxy';
import { memoryProbe, tempReport, type MemoryProbe } from './memory';
import { stitchPngs } from './png';
import { createSerialQueue, type Serial } from './queue';
import { selectorCss } from './selectors';
import { childSitemaps, parseSitemap, type SiteScan } from './pages';
import { checkUrl, createRequestGuard, publicOnly, type HostPolicy, type RequestGuard, type RequestVerdict } from './url-guard';

export const MAX_CAPTURE_HEIGHT = 12_000; // CSS px; taller full pages are trimmed
const NAV_TIMEOUT = 30_000;
const VIEWPORT_HEIGHT = 900;
const SHOT_TIMEOUT = 60_000;
const SLICE_DEVICE_PX = 6000;
/** Serverless: full pages taller than this (device px) are captured in viewport-tall bands (bandShots). */
const BAND_FROM_DEVICE_PX = SLICE_DEVICE_PX;
const BAND_SETTLE_MS = 100;
const BAND_IMAGE_WAIT_MS = 800; // most a band waits for images that start loading only then
const IDLE_CLOSE_MS = 10 * 60_000; // free the browser after 10 idle minutes
const BANNERS_CSS = path.join(process.cwd(), 'lib/capture/banners.css');
const BANNERS_ID = '__layout-stage-banners';
/** CAPTURE_DEBUG=1 logs each phase's timing and memory and, on a load timeout, the requests still open. */
const DEBUG = !!process.env.CAPTURE_DEBUG;
const MB = 1024 * 1024;

/** The Chromium pack that matches @sparticuz/chromium-min's version (x64, which is what Vercel
 *  functions run on). Keep the two in step when upgrading. */
export const DEFAULT_CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar';

/** Where the serverless Chromium comes from: CHROMIUM_PACK_URL, else the default pack on Vercel.
 *  null means Playwright's own Chromium (local use). */
export function chromiumPackUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.CHROMIUM_PACK_URL?.trim();
  if (url) return url;
  return env.VERCEL ? DEFAULT_CHROMIUM_PACK_URL : null;
}

const switchName = (arg: string) => arg.split('=', 1)[0].toLowerCase();

/** chromium-min flags left out. Chromium keeps only the last --enable-features / --disable-features,
 *  so chromium-min's would replace Playwright's own (its request routing and screenshots rely on
 *  them); a capture should load pages the way Chrome does, so no --disable-web-security or
 *  --allow-running-insecure-content; and the guard proxy alone decides where the browser connects. */
const DROPPED_SWITCHES = new Set([
  '--enable-features',
  '--disable-features',
  '--disable-web-security',
  '--allow-running-insecure-content',
  '--no-proxy-server',
  '--host-resolver-rules',
]);

/** The browser's command-line flags: the serverless build's own (when there is one), then ours,
 *  which nothing may override. Every connection goes through the guard proxy, loopback included. */
export function browserArgs(proxyUrl: string, serverlessArgs: readonly string[] = []): string[] {
  const own = [
    `--proxy-server=${proxyUrl}`,
    '--proxy-bypass-list=<-loopback>',
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-dev-shm-usage',
  ];
  const taken = new Set(own.map(switchName));
  const extra = serverlessArgs.filter((arg) => {
    const name = switchName(arg);
    return !taken.has(name) && !DROPPED_SWITCHES.has(name) && !name.startsWith('--proxy-');
  });
  return [...extra, ...own];
}

/** Hosted, the route's response body has to stay under the host's cap (Vercel Functions: 4.5 MB),
 *  and a full-page 2× PNG is often 10–20 MB. Locally there is no cap and captures stay PNG. */
export const HOSTED_RESPONSE_BUDGET = 4_000_000;
export function responseBudget(env: Record<string, string | undefined> = process.env): number {
  return chromiumPackUrl(env) ? HOSTED_RESPONSE_BUDGET : Infinity;
}
/** WebP qualities tried in turn until the slices fit the budget (stripe.com, full page at 2×:
 *  17.7 MB as PNG, 3.6 MB as WebP at 0.92, 2.4 MB at 0.8). */
const WEBP_QUALITIES = [0.92, 0.8, 0.65];
export const TOO_LARGE_MESSAGE = 'That page is too big to send back in one piece. Try First screen or 1× sharpness.';
export const TOO_HEAVY_MESSAGE = 'This page is too heavy to capture on the hosted app. Try First screen or 1× sharpness, or run Layout Stage on your computer.';

export interface CaptureInput extends CaptureOptions {
  url: string;
  /** HTTP basic auth for this capture only, sent to the page's own origin only. Never logged. */
  auth?: CaptureAuth | null;
}
export interface CaptureImage {
  type: 'image/png' | 'image/webp';
  data: Buffer;
}
export interface CaptureResult {
  /** One PNG; or, when that would be over the run's maxBytes, WebP slices of the same width,
   *  top to bottom (each at most 6000 px tall), for the client to join. */
  images: CaptureImage[];
  trimmed: boolean;
  finalUrl: string;
}
export interface CaptureRunOptions {
  signal?: AbortSignal;
  /** Which hosts may be contacted. Defaults to DNS + public addresses only; tests swap it. */
  policy?: HostPolicy;
  /** Most bytes the images may take together (default: no limit). See responseBudget(). */
  maxBytes?: number;
  /** Capture tall full pages in viewport-tall bands (see bandShots). Default: with the serverless
   *  Chromium only; locally full pages are captured as before. */
  bands?: boolean;
}

/* One browser (behind one guard proxy) and one queue per server process, kept on globalThis so
   `next dev` reloads reuse them. */
interface Session {
  browser: Browser;
  proxy: GuardProxy;
  /** The serverless Chromium runs as a single process, which can't start a renderer for a second
   *  browser context: it serves one capture and closes (relaunching from /tmp is quick). */
  singleUse: boolean;
}
interface Shared {
  session: Promise<Session> | null;
  queue: Serial;
  idle?: ReturnType<typeof setTimeout>;
}
const g = globalThis as typeof globalThis & { __layoutStageCapture?: Shared };
const shared: Shared = (g.__layoutStageCapture ??= { session: null, queue: createSerialQueue() });

/** Captures a public web page as a PNG (or WebP slices, see CaptureResult). One capture runs at a
 *  time; the rest wait their turn. Throws CaptureError. */
export function captureScreenshot(input: CaptureInput, opts: CaptureRunOptions = {}): Promise<CaptureResult> {
  return shared.queue(async () => {
    if (opts.signal?.aborted) throw new CaptureError('aborted');
    clearTimeout(shared.idle);
    try {
      return await capture(input, opts.policy ?? publicOnly(), opts.maxBytes ?? Infinity, opts.signal, opts.bands);
    } finally {
      if ((await shared.session?.catch(() => null))?.singleUse) {
        await shutdownCapture();
      } else {
        shared.idle = setTimeout(() => void shutdownCapture(), IDLE_CLOSE_MS);
        shared.idle.unref?.();
      }
    }
  });
}

/** Closes the browser and its proxy (they start again on the next capture). */
export async function shutdownCapture(): Promise<void> {
  clearTimeout(shared.idle);
  const p = shared.session;
  shared.session = null;
  const s = await p?.catch(() => null);
  await s?.browser.close().catch(() => undefined);
  await s?.proxy.close().catch(() => undefined);
}

async function getSession(): Promise<Session> {
  if (shared.session) {
    const s = await shared.session.catch(() => null);
    if (s?.browser.isConnected()) return s;
    await s?.proxy.close().catch(() => undefined);
    shared.session = null;
  }
  const p = launch();
  shared.session = p;
  try {
    return await p;
  } catch (e) {
    if (shared.session === p) shared.session = null;
    throw e;
  }
}

async function launch(): Promise<Session> {
  const proxy = await startGuardProxy(createRequestGuard());
  const pack = chromiumPackUrl();
  const t0 = Date.now();
  try {
    let browser: Browser;
    let note = '';
    if (pack) {
      const options = await serverlessChromium(pack, proxy.url);
      const reserve = tempReserve(await tempFree());
      browser = await whileHeld(reserve, () => chromium.launch(options));
      note = ` (serverless, started with ${Math.round(reserve / MB)}MB of ${os.tmpdir()} held back)`;
    } else {
      browser = await chromium.launch({ headless: true, args: browserArgs(proxy.url) });
    }
    if (DEBUG) console.log(`[capture] browser ${browser.version()} up in ${Date.now() - t0}ms${note}; ${tempReport()}`);
    browser.on('disconnected', () => void proxy.close().catch(() => undefined));
    return { browser, proxy, singleUse: !!pack };
  } catch (e) {
    await proxy.close().catch(() => undefined);
    // An unpack cut short leaves a broken binary that chromium-min would reuse; unpack again next time.
    if (pack) await rm(path.join(os.tmpdir(), 'chromium'), { force: true }).catch(() => undefined);
    const err = navError(e);
    if (err.code === 'no_browser' && !pack) throw err;
    console.error('[capture] browser launch failed:', e);
    throw new CaptureError('failed');
  }
}

/** @sparticuz/chromium-min's Chromium. The first launch on a fresh instance downloads the pack
 *  (about 65 MB) and unpacks it to /tmp, which makes that capture several seconds slower; later
 *  launches on the same instance reuse it. WebGL is off: its software renderer on one vCPU stalls
 *  for minutes on pages with animated 3D (vercel.com), so such canvases show their fallback. */
async function serverlessChromium(pack: string, proxyUrl: string): Promise<LaunchOptions> {
  const { default: serverless } = await import('@sparticuz/chromium-min');
  serverless.setGraphicsMode = false;
  const t0 = Date.now();
  const executablePath = await serverless.executablePath(pack);
  if (DEBUG) console.log(`[capture] serverless Chromium unpacked in ${Date.now() - t0}ms`);
  // The download (67 MB) is only needed for unpacking: from now on chromium-min reuses /tmp/chromium.
  if (/^https?:\/\//i.test(pack)) await rm(path.join(os.tmpdir(), 'chromium-pack'), { recursive: true, force: true }).catch(() => undefined);
  return { headless: true, executablePath, args: browserArgs(proxyUrl, serverless.args) };
}

/* Serverless, /tmp is the browser's working memory too. Vercel has no /dev/shm, so (with
   --disable-dev-shm-usage) Chromium keeps its shared memory, which holds raster tiles, frames and
   decoded images, as files in /tmp: 525 MB, of which the unpacked browser takes about 210 MB. When
   /tmp runs out, the single-process browser crashes (SIGTRAP); stripe.com at 1440, 2× did, on its
   first band. Three things keep a heavy page within it: deleting the download once unpacked (above),
   dropping caches between bands (PURGE_BELOW), and starting the browser with part of /tmp held back.
   Chromium caps its discardable memory (decoded images, the largest part) at half the free space in
   /tmp at start-up, so with all ~300 MB free it would let images take what the tiles need. Started
   with free space held to 2 × DISCARDABLE_LIMIT, it caps them at DISCARDABLE_LIMIT, about what it got
   with the download still there. Don't go lower: at a 64–96 MB cap apple.com's carousels lost images. */
const DISCARDABLE_LIMIT = 128 * MB;
/** Bands: the first band, and any band that starts with less than this free in /tmp, start with
 *  Chromium told that memory is critical, which drops its caches (decoded images above all) so the band
 *  has room for its own. Waking lazy content leaves decoded images from all over the page behind (the
 *  first band then took 160 MB more on apple.com, which crashed); later bands take up to ~60 MB more
 *  than the last. It has a cost: the page's scripts see the pause, and apple.com's carousels then
 *  sometimes kept an item empty (2 runs in 7), which beats a crash. */
const PURGE_BELOW = 128 * MB;

/** How much of `free` bytes in /tmp to hold back while the browser starts (see DISCARDABLE_LIMIT). */
export function tempReserve(free: number): number {
  return Number.isFinite(free) ? Math.max(0, Math.floor(free - 2 * DISCARDABLE_LIMIT)) : 0;
}

async function tempFree(): Promise<number> {
  try {
    const s = await statfs(os.tmpdir());
    return s.bavail * s.bsize;
  } catch {
    return NaN;
  }
}

/** Runs `start` with `bytes` of the temp folder taken up by a file (as far as there is room), then frees them. */
async function whileHeld<T>(bytes: number, start: () => Promise<T>): Promise<T> {
  if (bytes <= 0) return start();
  const file = path.join(os.tmpdir(), 'layout-stage-reserve');
  try {
    const handle = await openFile(file, 'w');
    try {
      const chunk = Buffer.alloc(4 * MB, 1);
      for (let n = 0; n < bytes; n += chunk.length) await handle.write(chunk, 0, Math.min(chunk.length, bytes - n));
    } catch {
      // Less room than statfs said: start with what was written.
    } finally {
      await handle.close();
    }
    return await start();
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

/** Desktop Chrome's own user agent (headless Chromium announces itself, which trips bot walls),
 *  or Chrome on a 390 px Android phone. */
function userAgent(browser: Browser, phone: boolean): string {
  const major = browser.version().split('.')[0];
  if (phone) return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`;
  const os = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** banners.css, read at run time so the selector list can be edited without a rebuild. */
async function bannerCss(): Promise<string> {
  try {
    return await readFile(BANNERS_CSS, 'utf8');
  } catch {
    console.warn(`[capture] ${BANNERS_CSS} not found; capturing without hiding cookie banners.`);
    return '';
  }
}

/** Runs in every frame before the page's own scripts: adds the banner stylesheet as early as possible. */
const bannerInitScript = (css: string) => `(() => {
  const css = ${JSON.stringify(css)};
  const add = () => {
    if (document.getElementById(${JSON.stringify(BANNERS_ID)})) return;
    const s = document.createElement('style');
    s.id = ${JSON.stringify(BANNERS_ID)};
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) add();
  document.addEventListener('DOMContentLoaded', add);
})();`;

function refusal(v: RequestVerdict): CaptureError {
  if (v === 'unresolved') return new CaptureError('unreachable', NOT_FOUND_MESSAGE);
  if (v === 'scheme') return new CaptureError('invalid_url', SCHEME_MESSAGE);
  return new CaptureError('private');
}

async function capture(input: CaptureInput, policy: HostPolicy, maxBytes: number, signal?: AbortSignal, bands?: boolean): Promise<CaptureResult> {
  const target = await checkUrl(input.url, policy);
  const guard = createRequestGuard(policy);
  const { browser, proxy, singleUse } = await getSession();
  proxy.setGuard(guard);
  const phone = input.width === 390;
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: input.width, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: input.scale,
      isMobile: phone,
      hasTouch: phone,
      userAgent: userAgent(browser, phone),
      locale: 'en-US',
      colorScheme: input.darkMode ? 'dark' : 'light',
      // Answered only when the page's own origin asks (a 401), never to other hosts it loads from.
      httpCredentials: input.auth ? { username: input.auth.username, password: input.auth.password, origin: target.origin, send: 'unauthorized' } : undefined,
      serviceWorkers: 'block',
      acceptDownloads: false,
      bypassCSP: true, // so the banner and hide-elements stylesheet also applies on strict-CSP sites
    });
  } catch (e) {
    console.error('[capture] new context failed:', loggable(e, input.auth));
    throw new CaptureError('failed');
  }
  // A busy single-process browser may not get round to closing a context; closing the browser
  // ends it (Playwright kills the process if it doesn't close in time).
  const onAbort = () => void (singleUse ? browser : context).close().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  const probe = DEBUG ? memoryProbe() : null;
  try {
    return await untilBrowserExits(browser, run(context, target, input, guard, maxBytes, bands ?? singleUse, probe));
  } catch (e) {
    if (signal?.aborted) throw new CaptureError('aborted');
    // A call cut off by the crash may fail before the exit is reported.
    const err = e instanceof BrowserExited || !browser.isConnected() ? exitError(singleUse) : navError(e);
    if (err.code === 'failed') console.error('[capture] failed:', loggable(e, input.auth), probe ? `(${probe.note()})` : '');
    throw err;
  } finally {
    probe?.stop();
    signal?.removeEventListener('abort', onAbort);
    if (browser.isConnected()) await context.close().catch(() => undefined);
  }
}

/** An error as it may be logged: with credentials in play, its text with them blanked out. */
function loggable(e: unknown, auth: CaptureAuth | null | undefined): unknown {
  if (!auth) return e;
  return redactAuth(e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e), auth);
}

class BrowserExited extends Error {
  constructor() {
    super('The capture browser exited during the capture.');
  }
}

/** What a capture says when the browser went away in the middle of it. The serverless one runs as a
 *  single process, so any crash takes it down, and on a heavy page the usual cause is running out of
 *  room in /tmp (see DISCARDABLE_LIMIT): say what to try. */
export function exitError(serverless: boolean): CaptureError {
  return serverless ? new CaptureError('failed', TOO_HEAVY_MESSAGE) : new CaptureError('failed');
}

/** Settles like `work`, or fails as soon as the browser exits (a crash): Playwright can leave calls
 *  that were waiting on it pending for good, which would hold up every later capture. */
function untilBrowserExits<T>(browser: Browser, work: Promise<T>): Promise<T> {
  let onExit = () => undefined as void;
  const exited = new Promise<never>((_, reject) => {
    onExit = () => reject(new BrowserExited());
    browser.once('disconnected', onExit);
  });
  return Promise.race([work, exited]).finally(() => browser.off('disconnected', onExit));
}

async function run(context: BrowserContext, target: URL, input: CaptureInput, guard: RequestGuard, maxBytes: number, bands: boolean, probe: MemoryProbe | null): Promise<CaptureResult> {
  let page: Page | null = null;
  const isMainDocument = (req: PwRequest) => {
    try {
      return req.isNavigationRequest() && !!page && req.frame() === page.mainFrame();
    } catch {
      return false;
    }
  };

  // First line: Playwright routing aborts refused requests early. It doesn't see redirect hops;
  // the guard proxy (every connection) does.
  await context.route('**/*', async (route) => {
    const v = await guard(route.request().url());
    return (v === 'ok' ? route.continue() : route.abort('blockedbyclient')).catch(() => undefined);
  });
  await context.routeWebSocket(
    () => true,
    async (ws) => {
      if ((await guard(ws.url())) === 'ok') ws.connectToServer();
      else await ws.close().catch(() => undefined);
    },
  );
  context.on('page', (p) => {
    if (page && p !== page) void p.close().catch(() => undefined); // no popups
  });

  const css = [input.hideBanners ? await bannerCss() : '', selectorCss(input.hideSelectors ?? [])].filter(Boolean).join('\n');
  if (css) await context.addInitScript({ content: bannerInitScript(css) });

  page = await context.newPage();
  const main = page;
  const t0 = Date.now();
  const log = probe ? (msg: string) => console.log(`[capture] ${target.host} +${Date.now() - t0}ms ${msg} (${probe.note()})`) : () => undefined;
  const open = new Map<PwRequest, number>();
  if (DEBUG) {
    main.on('request', (r) => open.set(r, Date.now()));
    main.on('requestfinished', (r) => open.delete(r));
    main.on('requestfailed', (r) => open.delete(r));
  }
  // The main document's latest URL (each redirect hop, later navigations) and status.
  let docUrl = target.href;
  let status = 0;
  main.on('request', (r) => {
    if (isMainDocument(r)) docUrl = r.url();
  });
  main.on('response', (r) => {
    if (isMainDocument(r.request())) status = r.status();
  });
  /** The main document went (or tried to go) somewhere that isn't allowed. */
  const docRefused = async () => {
    const v = await guard(docUrl);
    return v === 'ok' ? null : refusal(v);
  };

  // Load: wait for network idle, but never past 30 s; if idle doesn't come, carry on from `load`.
  const started = Date.now();
  try {
    const res = await main.goto(target.href, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    status ||= res?.status() ?? 0;
  } catch (e) {
    open.forEach((t, r) => log(`still loading after ${Date.now() - t}ms: ${r.url().slice(0, 140)}`));
    throw (await docRefused()) ?? navError(e);
  }
  log(`load (status ${status})`);
  const left = NAV_TIMEOUT - (Date.now() - started);
  if (left > 0) await main.waitForLoadState('networkidle', { timeout: left }).then(() => log('network idle'), () => log('no network idle; carrying on'));

  // Password walls, bot walls and error pages. A challenge that clears itself navigates on; give it a moment.
  let err = (await docRefused()) ?? authError(status, !!input.auth) ?? (await checkPage(main, status));
  if (err?.code === 'blocked') {
    await main
      .waitForEvent('framenavigated', { predicate: (f) => f === main.mainFrame(), timeout: 6000 })
      .then(() => main.waitForLoadState('load', { timeout: 10_000 }))
      .catch(() => undefined);
    err = (await docRefused()) ?? authError(status, !!input.auth) ?? (await checkPage(main, status));
  }
  if (err) throw err;

  if (css) await main.addStyleTag({ content: css }).catch(() => undefined); // in case the page dropped it
  if (input.fullPage) await wakeLazyContent(main);
  log('lazy content woken');
  if (input.delayMs > 0) await main.waitForTimeout(input.delayMs);
  await main.evaluate(() => Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 3000))])).catch(() => undefined);
  err = await docRefused(); // a late redirect somewhere it shouldn't go
  if (err) throw err;
  if (main.url().startsWith('chrome-error:')) throw new CaptureError('failed');

  const height = await main.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
  const trimmed = input.fullPage && height > MAX_CAPTURE_HEIGHT;
  const finalUrl = main.url();
  const shotHeight = Math.min(Math.max(height, VIEWPORT_HEIGHT), MAX_CAPTURE_HEIGHT);
  // The top `shotHeight` CSS px, in slices of at most 6000 device px: in one go, Chromium leaves
  // the lower part of tall 2× captures of busy pages blank.
  const shot = (y: number, h: number) =>
    main.screenshot({ fullPage: true, clip: { x: 0, y, width: input.width, height: h }, animations: 'disabled', type: 'png', timeout: SHOT_TIMEOUT });
  let slices: Buffer[] = [];
  log(`page height ${height}; capturing ${shotHeight} px`);
  if (input.fullPage && bands && shotHeight * input.scale > BAND_FROM_DEVICE_PX) {
    slices = await bandShots(main, input.width, shotHeight, log);
  } else if (input.fullPage) {
    const step = Math.floor(SLICE_DEVICE_PX / input.scale);
    for (let y = 0; y < shotHeight; y += step) slices.push(await shot(y, Math.min(step, shotHeight - y)));
  } else {
    slices.push(await main.screenshot({ animations: 'disabled', type: 'png', timeout: SHOT_TIMEOUT }));
  }
  log(`screenshot ${slices.length} slice(s), ${byteLength(slices)} bytes, page height ${height}`);

  // One PNG when it fits the budget, else WebP slices that do.
  if (byteLength(slices) <= maxBytes) {
    const png = await stitchPngs(slices).catch((e) => {
      console.warn('[capture] joining slices failed; taking one screenshot instead:', e);
      return shot(0, shotHeight);
    });
    if (png.length <= maxBytes) return { images: [{ type: 'image/png', data: png }], trimmed, finalUrl };
  }
  const images = await toWebp(main, slices, maxBytes);
  log(`re-encoded as ${images.length} WebP slice(s), ${byteLength(images.map((i) => i.data))} bytes`);
  return { images, trimmed, finalUrl };
}

const byteLength = (bufs: Buffer[]) => bufs.reduce((n, b) => n + b.length, 0);

/** Serverless: the top `shotHeight` CSS px of a tall page as viewport-tall bands, top to bottom.
 *  A full-page screenshot has Chromium rasterize far beyond the viewport, which needs more memory than
 *  the serverless browser has (its shared memory lives in /tmp: see DISCARDABLE_LIMIT and PURGE_BELOW):
 *  for stripe.com at 1440, 2× the single-process browser peaked at 1.44–1.51 GB with full-page slices
 *  and 1.07 GB with bands (the page itself takes ~0.87 GB).
 *  The window stays scrolled to the top, as for a full-page shot; the page moves up under the
 *  viewport instead (a transform on <html>), one viewport at a time. Nothing scrolls, so nothing
 *  repeats at the seams: <html> becomes the containing block of fixed elements (a fixed header shows
 *  once at the top; a fixed chat button lands at the bottom of the page rather than of the first
 *  screen), sticky elements stay where they sit at the top of the page, and "scrolled" states
 *  (headers, backgrounds) stay off. Content that reveals itself when it comes into view still does:
 *  IntersectionObserver sees the transform. */
async function bandShots(page: Page, width: number, shotHeight: number, log: (msg: string) => void): Promise<Buffer[]> {
  const vh = await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    return window.innerHeight;
  }).then((h) => (h > 0 ? h : VIEWPORT_HEIGHT));
  const bands: Buffer[] = [];
  let cdp: CDPSession | null = null;
  try {
    for (let y = 0; y < shotHeight; y += vh) {
      const h = Math.min(vh, shotHeight - y);
      if (bands.length === 0 || (await tempFree()) < PURGE_BELOW) {
        cdp ??= await page.context().newCDPSession(page);
        await cdp.send('Memory.simulatePressureNotification', { level: 'critical' }).catch(() => undefined);
        log(`caches dropped before band ${bands.length + 1}`);
      }
      await page.evaluate(
        async ({ y, settle, wait }) => {
          document.documentElement.style.setProperty('transform', `translateY(${-y}px)`, 'important');
          for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
          // Images that start loading only now (lazy loaders the first pass missed) get a moment.
          const pending = Array.from(document.images).filter((img) => {
            const r = img.getBoundingClientRect();
            return !img.complete && r.bottom > 0 && r.top < window.innerHeight;
          });
          const loaded = pending.map(
            (img) =>
              new Promise((r) => {
                img.addEventListener('load', r, { once: true });
                img.addEventListener('error', r, { once: true });
              }),
          );
          await Promise.race([Promise.all(loaded), new Promise((r) => setTimeout(r, wait))]);
          await new Promise((r) => setTimeout(r, settle));
        },
        { y, settle: BAND_SETTLE_MS, wait: BAND_IMAGE_WAIT_MS },
      );
      bands.push(await page.screenshot({ clip: { x: 0, y: 0, width, height: h }, animations: 'disabled', type: 'png', timeout: SHOT_TIMEOUT }));
      log(`band ${bands.length} at ${y}`);
    }
  } finally {
    await cdp?.detach().catch(() => undefined);
    await page.evaluate(() => document.documentElement.style.removeProperty('transform')).catch(() => undefined);
  }
  return bands;
}

/** Re-encodes PNG slices as WebP in the capture browser (no image library on the server), trying
 *  lower qualities until they fit in maxBytes. Leaves the page on about:blank. Slices stay at most
 *  6000 px tall, well inside WebP's 16383 px limit. */
async function toWebp(page: Page, slices: Buffer[], maxBytes: number): Promise<CaptureImage[]> {
  await page.goto('about:blank'); // a clean page: the captured site's scripts can't interfere
  const pngs = slices.map((s) => s.toString('base64'));
  for (const quality of WEBP_QUALITIES) {
    const images: CaptureImage[] = [];
    for (const png of pngs) {
      const webp = await page.evaluate(
        async ({ png, quality }) => {
          const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
          bitmap.close();
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
          if (blob.type !== 'image/webp') throw new Error('this browser has no WebP encoder');
          const out = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
          return btoa(s);
        },
        { png, quality },
      );
      images.push({ type: 'image/webp', data: Buffer.from(webp, 'base64') });
    }
    if (byteLength(images.map((i) => i.data)) <= maxBytes) return images;
  }
  throw new CaptureError('failed', TOO_LARGE_MESSAGE);
}

async function checkPage(page: Page, status: number): Promise<CaptureError | null> {
  const [title, html] = await Promise.all([page.title().catch(() => ''), page.content().catch(() => '')]);
  return pageError(status, title, html);
}

/** Full page: scroll to the bottom (up to the height cap) in viewport-sized steps so lazy images
 *  and scroll-triggered content load, give pending images a moment, then return to the top. */
async function wakeLazyContent(page: Page): Promise<void> {
  await page.evaluate(async (max) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const root = document.scrollingElement || document.documentElement;
    const step = window.innerHeight || 900;
    for (let y = step, i = 0; i < 80; i++, y += step) {
      const end = Math.max(0, Math.min(root.scrollHeight, max) - step);
      window.scrollTo({ top: Math.min(y, end), behavior: 'instant' });
      await sleep(150);
      if (y >= end) break;
    }
    const pending = Array.from(document.images).filter((img) => !img.complete && img.getBoundingClientRect().top + window.scrollY < max);
    const loaded = pending.map(
      (img) =>
        new Promise((r) => {
          img.addEventListener('load', r, { once: true });
          img.addEventListener('error', r, { once: true });
        }),
    );
    await Promise.race([Promise.all(loaded), sleep(5000)]);
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(100);
  }, MAX_CAPTURE_HEIGHT);
}

/* ---------------- a site's pages (capturing a whole template) ---------------- */

/** Most characters of a sitemap read. */
const SITEMAP_CHARS = 2_000_000;
const SITEMAP_TIMEOUT_MS = 8000;

/** Reads a site's menu links and sitemap, starting at `input.url`, with the capture browser behind the
 *  same guard (public addresses only, every connection checked). lib/capture/pages.ts turns the result
 *  into the list of pages to capture. Waits its turn like a capture. Throws CaptureError. */
export function findSitePages(input: { url: string; auth: CaptureAuth | null }, opts: { signal?: AbortSignal; policy?: HostPolicy } = {}): Promise<SiteScan> {
  return shared.queue(async () => {
    if (opts.signal?.aborted) throw new CaptureError('aborted');
    clearTimeout(shared.idle);
    try {
      return await scanSite(input, opts.policy ?? publicOnly(), opts.signal);
    } finally {
      if ((await shared.session?.catch(() => null))?.singleUse) {
        await shutdownCapture();
      } else {
        shared.idle = setTimeout(() => void shutdownCapture(), IDLE_CLOSE_MS);
        shared.idle.unref?.();
      }
    }
  });
}

async function scanSite(input: { url: string; auth: CaptureAuth | null }, policy: HostPolicy, signal?: AbortSignal): Promise<SiteScan> {
  const target = await checkUrl(input.url, policy);
  const guard = createRequestGuard(policy);
  const { browser, proxy, singleUse } = await getSession();
  proxy.setGuard(guard);
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: VIEWPORT_HEIGHT },
      userAgent: userAgent(browser, false),
      locale: 'en-US',
      httpCredentials: input.auth ? { username: input.auth.username, password: input.auth.password, origin: target.origin, send: 'unauthorized' } : undefined,
      serviceWorkers: 'block',
      acceptDownloads: false,
      bypassCSP: true, // so reading the sitemap from the page isn't blocked by its connect-src
    });
  } catch (e) {
    console.error('[capture] new context failed:', loggable(e, input.auth));
    throw new CaptureError('failed');
  }
  const onAbort = () => void (singleUse ? browser : context).close().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await untilBrowserExits(browser, readSite(context, target, input, guard));
  } catch (e) {
    if (signal?.aborted) throw new CaptureError('aborted');
    const err = navError(e);
    if (err.code === 'failed') console.error('[capture] reading pages failed:', loggable(e, input.auth));
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (browser.isConnected()) await context.close().catch(() => undefined);
  }
}

async function readSite(context: BrowserContext, target: URL, input: { auth: CaptureAuth | null }, guard: RequestGuard): Promise<SiteScan> {
  await context.route('**/*', async (route) => {
    const v = await guard(route.request().url());
    return (v === 'ok' ? route.continue() : route.abort('blockedbyclient')).catch(() => undefined);
  });
  await context.routeWebSocket(() => true, (ws) => void ws.close().catch(() => undefined));
  const page = await context.newPage();
  let status = 0;
  try {
    status = (await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }))?.status() ?? 0;
  } catch (e) {
    throw navError(e);
  }
  // Menus built by scripts are there by `load`; don't wait long for it.
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => undefined);
  const v = await guard(page.url());
  if (v !== 'ok') throw refusal(v);
  const err = authError(status, !!input.auth) ?? (await checkPage(page, status));
  if (err) throw err;

  const { nav, links } = await page.evaluate(() => {
    const read = (root: ParentNode) =>
      Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'), (a) => ({ href: a.href, text: (a.innerText || a.textContent || '').trim().slice(0, 120) }));
    const seen = new Set<string>();
    const nav: { href: string; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('header, nav, [role="navigation"]'))) {
      for (const l of read(el)) {
        if (seen.has(l.href)) continue;
        seen.add(l.href);
        nav.push(l);
      }
    }
    return { nav: nav.slice(0, 200), links: read(document).slice(0, 500) };
  });
  return { finalUrl: page.url(), nav, links, sitemap: await readSitemap(page) };
}

/** The site's sitemap page addresses, read from the page itself (same origin, through the guard):
 *  /sitemap.xml, else the usual WordPress names; an index's page sitemaps first. */
async function readSitemap(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const get = (path: string) =>
    page
      .evaluate(
        async ({ path, max, ms }) => {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), ms);
          try {
            const r = await fetch(path, { credentials: 'same-origin', signal: ctl.signal });
            if (!r.ok || new URL(r.url).origin !== location.origin) return '';
            return (await r.text()).slice(0, max);
          } catch {
            return '';
          } finally {
            clearTimeout(t);
          }
        },
        { path, max: SITEMAP_CHARS, ms: SITEMAP_TIMEOUT_MS },
      )
      .catch(() => '');
  let map = { urls: [] as string[], sitemaps: [] as string[] };
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    map = parseSitemap(await get(path));
    if (map.urls.length || map.sitemaps.length) break;
  }
  const urls = [...map.urls];
  const children = map.sitemaps.filter((s) => {
    try {
      return new URL(s).origin === origin;
    } catch {
      return false;
    }
  });
  for (const s of childSitemaps(children)) {
    const u = new URL(s);
    urls.push(...parseSitemap(await get(u.pathname + u.search)).urls);
  }
  return urls.slice(0, 2000);
}
