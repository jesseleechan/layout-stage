/* URL capture with Playwright's Chromium. This is the only file to change when hosting needs a
   different browser (e.g. puppeteer-core + @sparticuz/chromium-min on Vercel): keep the
   captureScreenshot() signature, launch the browser behind the guard proxy, throw CaptureError.
   Server only. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request as PwRequest } from 'playwright';
import type { CaptureOptions } from '../model';
import { navError, pageError } from './detect';
import { CaptureError, NOT_FOUND_MESSAGE, SCHEME_MESSAGE } from './errors';
import { startGuardProxy, type GuardProxy } from './guard-proxy';
import { stitchPngs } from './png';
import { createSerialQueue, type Serial } from './queue';
import { checkUrl, createRequestGuard, publicOnly, type HostPolicy, type RequestGuard, type RequestVerdict } from './url-guard';

export const MAX_CAPTURE_HEIGHT = 12_000; // CSS px; taller full pages are trimmed
const NAV_TIMEOUT = 30_000;
const VIEWPORT_HEIGHT = 900;
const SHOT_TIMEOUT = 60_000;
const SLICE_DEVICE_PX = 6000;
const IDLE_CLOSE_MS = 10 * 60_000; // free the browser after 10 idle minutes
const BANNERS_CSS = path.join(process.cwd(), 'lib/capture/banners.css');
const BANNERS_ID = '__layout-stage-banners';
/** CAPTURE_DEBUG=1 logs each phase's timing and, on a load timeout, the requests still open. */
const DEBUG = !!process.env.CAPTURE_DEBUG;

export interface CaptureInput extends CaptureOptions {
  url: string;
}
export interface CaptureResult {
  png: Buffer;
  trimmed: boolean;
  finalUrl: string;
}
export interface CaptureRunOptions {
  signal?: AbortSignal;
  /** Which hosts may be contacted. Defaults to DNS + public addresses only; tests swap it. */
  policy?: HostPolicy;
}

/* One browser (behind one guard proxy) and one queue per server process, kept on globalThis so
   `next dev` reloads reuse them. */
interface Session {
  browser: Browser;
  proxy: GuardProxy;
}
interface Shared {
  session: Promise<Session> | null;
  queue: Serial;
  idle?: ReturnType<typeof setTimeout>;
}
const g = globalThis as typeof globalThis & { __layoutStageCapture?: Shared };
const shared: Shared = (g.__layoutStageCapture ??= { session: null, queue: createSerialQueue() });

/** Captures a public web page as a PNG. One capture runs at a time; the rest wait their turn.
 *  Throws CaptureError. */
export function captureScreenshot(input: CaptureInput, opts: CaptureRunOptions = {}): Promise<CaptureResult> {
  return shared.queue(async () => {
    if (opts.signal?.aborted) throw new CaptureError('aborted');
    clearTimeout(shared.idle);
    try {
      return await capture(input, opts.policy ?? publicOnly(), opts.signal);
    } finally {
      shared.idle = setTimeout(() => void shutdownCapture(), IDLE_CLOSE_MS);
      shared.idle.unref?.();
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
  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        `--proxy-server=${proxy.url}`, // every connection goes through the guard proxy …
        '--proxy-bypass-list=<-loopback>', // … loopback included
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-dev-shm-usage',
      ],
    });
    browser.on('disconnected', () => void proxy.close().catch(() => undefined));
    return { browser, proxy };
  } catch (e) {
    await proxy.close().catch(() => undefined);
    const err = navError(e);
    if (err.code === 'no_browser') throw err;
    console.error('[capture] browser launch failed:', e);
    throw new CaptureError('failed');
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

async function capture(input: CaptureInput, policy: HostPolicy, signal?: AbortSignal): Promise<CaptureResult> {
  const target = await checkUrl(input.url, policy);
  const guard = createRequestGuard(policy);
  const { browser, proxy } = await getSession();
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
      colorScheme: 'light',
      serviceWorkers: 'block',
      acceptDownloads: false,
      bypassCSP: true, // so the banner stylesheet also applies on strict-CSP sites
    });
  } catch (e) {
    console.error('[capture] new context failed:', e);
    throw new CaptureError('failed');
  }
  const onAbort = () => void context.close().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await run(context, target, input, guard);
  } catch (e) {
    if (signal?.aborted) throw new CaptureError('aborted');
    const err = navError(e);
    if (err.code === 'failed') console.error('[capture] failed:', e);
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await context.close().catch(() => undefined);
  }
}

async function run(context: BrowserContext, target: URL, input: CaptureInput, guard: RequestGuard): Promise<CaptureResult> {
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

  const css = input.hideBanners ? await bannerCss() : '';
  if (css) await context.addInitScript({ content: bannerInitScript(css) });

  page = await context.newPage();
  const main = page;
  const t0 = Date.now();
  const log = DEBUG ? (msg: string) => console.log(`[capture] ${target.host} +${Date.now() - t0}ms ${msg}`) : () => undefined;
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

  // Bot walls and error pages. A challenge that clears itself navigates on; give it a moment.
  let err = (await docRefused()) ?? (await checkPage(main, status));
  if (err?.code === 'blocked') {
    await main
      .waitForEvent('framenavigated', { predicate: (f) => f === main.mainFrame(), timeout: 6000 })
      .then(() => main.waitForLoadState('load', { timeout: 10_000 }))
      .catch(() => undefined);
    err = (await docRefused()) ?? (await checkPage(main, status));
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
  const png = input.fullPage
    ? await fullPageShot(main, input.width, Math.min(Math.max(height, VIEWPORT_HEIGHT), MAX_CAPTURE_HEIGHT), input.scale)
    : await main.screenshot({ animations: 'disabled', type: 'png', timeout: SHOT_TIMEOUT });
  log(`screenshot ${png.length} bytes, page height ${height}`);
  return { png, trimmed, finalUrl: main.url() };
}

/** The top `height` CSS px of the page. Taken in slices of at most 6000 device px and joined:
 *  in one go, Chromium leaves the lower part of tall 2× captures of busy pages blank. */
async function fullPageShot(page: Page, width: number, height: number, scale: number): Promise<Buffer> {
  const shot = (y: number, h: number) =>
    page.screenshot({ fullPage: true, clip: { x: 0, y, width, height: h }, animations: 'disabled', type: 'png', timeout: SHOT_TIMEOUT });
  const step = Math.floor(SLICE_DEVICE_PX / scale);
  const slices: Buffer[] = [];
  for (let y = 0; y < height; y += step) slices.push(await shot(y, Math.min(step, height - y)));
  try {
    return await stitchPngs(slices);
  } catch (e) {
    console.warn('[capture] joining slices failed; taking one screenshot instead:', e);
    return shot(0, height);
  }
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
