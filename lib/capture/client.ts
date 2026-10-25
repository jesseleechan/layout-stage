/* Browser side of URL capture: calls POST /api/capture, names the result, remembers recent URLs. */
import type { CaptureOptions } from '../model';
import { getValue, setValue } from '../persist';
import { checkUrlShape } from './address';
import type { CaptureAuth } from './auth';
import { CaptureError, isCaptureErrorCode, SCHEME_MESSAGE } from './errors';
import type { SitePage } from './pages';
import { createSerialQueue } from './queue';

export const CAPTURE_ENDPOINT = '/api/capture';
export const RECENT_KEY = 'recentUrls';
export const RECENT_MAX = 10;
export const TRIMMED_MESSAGE = 'Captured the first 12,000 px of a very long page.';

export interface ClientCaptureResult {
  blob: Blob;
  trimmed: boolean;
  finalUrl: string;
}

/** Trims and adds https:// when the scheme is missing ("example.com/pricing", "//example.com"). */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (/^(mailto|javascript|data|file|about|blob|tel|ftp|view-source):/i.test(s)) return s; // refused by the check below
  return `https://${s}`;
}

/** Instant feedback for what can be judged without DNS (the server checks everything again). */
export function precheckUrl(url: string): CaptureError | null {
  const v = checkUrlShape(url);
  if (v.ok) return null;
  if (v.code === 'scheme') return new CaptureError('invalid_url', SCHEME_MESSAGE);
  return new CaptureError(v.code);
}

/** The layout name for a capture: hostname + path, without a trailing slash, query or hash. */
export function captureName(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, '');
    try {
      p = decodeURI(p);
    } catch {
      /* keep it encoded */
    }
    return u.hostname + p;
  } catch {
    return url;
  }
}

const queue = createSerialQueue();

/** The route's request body. `auth` goes with this one request only and is never stored. */
export function captureBody(url: string, options: CaptureOptions, auth?: CaptureAuth | null): string {
  const { width, fullPage, scale, delayMs, hideBanners, darkMode, hideSelectors } = options;
  return JSON.stringify({ url, width, fullPage, scale, delayMs, hideBanners, darkMode, hideSelectors, ...(auth ? { auth } : {}) });
}

/** Captures a URL through the server route; one at a time (the rest wait). Throws CaptureError.
 *  `auth`: HTTP basic auth for a staging site, sent with this request only. */
export function captureUrl(url: string, options: CaptureOptions, signal?: AbortSignal, auth?: CaptureAuth | null): Promise<ClientCaptureResult> {
  return queue(async () => {
    if (signal?.aborted) throw new CaptureError('aborted');
    let res: Response;
    try {
      res = await fetch(CAPTURE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: captureBody(url, options, auth),
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new CaptureError(signal?.aborted ? 'aborted' : 'network');
    }
    const type = res.headers.get('Content-Type') || '';
    const sliced = type.startsWith('multipart/form-data');
    if (!res.ok || !(type.startsWith('image/') || sliced)) {
      const data = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      const code = isCaptureErrorCode(data?.code) ? data.code : 'failed';
      throw new CaptureError(code, typeof data?.message === 'string' ? data.message : undefined);
    }
    let parts: Blob[];
    try {
      parts = sliced ? (await res.formData()).getAll('part').filter((p): p is File => p instanceof Blob) : [await res.blob()];
    } catch {
      throw new CaptureError(signal?.aborted ? 'aborted' : 'network');
    }
    if (!parts.length) throw new CaptureError('failed');
    let blob: Blob;
    try {
      blob = parts.length === 1 ? parts[0] : await joinImages(parts);
    } catch (e) {
      console.error('[capture] joining the slices failed:', e);
      throw new CaptureError('failed');
    }
    return { blob, trimmed: res.headers.get('X-Capture-Trimmed') === '1', finalUrl: res.headers.get('X-Capture-Url') || url };
  });
}

export const PAGES_ENDPOINT = '/api/pages';

/** A site's pages, for capturing a whole template (app/api/pages). Waits its turn with the captures
 *  (the server runs one browser job at a time anyway). Throws CaptureError. */
export function findPages(url: string, signal?: AbortSignal, auth?: CaptureAuth | null): Promise<SitePage[]> {
  return queue(async () => {
    if (signal?.aborted) throw new CaptureError('aborted');
    let res: Response;
    try {
      res = await fetch(PAGES_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ...(auth ? { auth } : {}) }),
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new CaptureError(signal?.aborted ? 'aborted' : 'network');
    }
    const data = (await res.json().catch(() => null)) as { pages?: unknown; code?: unknown; message?: unknown } | null;
    if (!res.ok || !Array.isArray(data?.pages)) {
      const code = isCaptureErrorCode(data?.code) ? data.code : 'failed';
      throw new CaptureError(code, typeof data?.message === 'string' ? data.message : undefined);
    }
    return (data.pages as SitePage[]).filter((p) => p && typeof p.url === 'string' && typeof p.title === 'string');
  });
}

/** Joins image slices of the same width top to bottom into one PNG. Hosted, a capture too big for
 *  one response arrives as WebP slices (each under WebP's height limit); from here on it stays
 *  lossless. Browser only; self-contained (tests run it in a page). */
export async function joinImages(parts: Blob[]): Promise<Blob> {
  const bitmaps = await Promise.all(parts.map((p) => createImageBitmap(p)));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmaps[0].width;
    canvas.height = bitmaps.reduce((h, b) => h + b.height, 0);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas');
    let y = 0;
    for (const b of bitmaps) {
      ctx.drawImage(b, 0, y);
      y += b.height;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(`could not encode a ${canvas.width}×${canvas.height} canvas`);
    return blob;
  } finally {
    bitmaps.forEach((b) => b.close());
    canvas.width = canvas.height = 0; // release the pixels now, not at garbage collection
  }
}

/* ---------------- recent URLs ---------------- */

/** Most recent first, no duplicates, at most `max`. */
export function pushRecent(list: readonly string[], url: string, max = RECENT_MAX): string[] {
  return [url, ...list.filter((u) => u !== url)].slice(0, max);
}

/** The URL as remembered: normalized, and never with a user name or password in it. */
export const canonical = (url: string) => {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.href;
  } catch {
    return url;
  }
};

export async function getRecentUrls(): Promise<string[]> {
  const v = await getValue<unknown>(RECENT_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
}

export async function addRecentUrl(url: string): Promise<string[]> {
  const next = pushRecent(await getRecentUrls(), canonical(url));
  await setValue(RECENT_KEY, next);
  return next;
}
