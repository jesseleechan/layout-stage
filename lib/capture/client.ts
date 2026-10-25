/* Browser side of URL capture: calls POST /api/capture, names the result, remembers recent URLs. */
import type { CaptureOptions } from '../model';
import { getValue, setValue } from '../persist';
import { checkUrlShape } from './address';
import { CaptureError, isCaptureErrorCode, SCHEME_MESSAGE } from './errors';
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

/** Captures a URL through the server route; one at a time (the rest wait). Throws CaptureError. */
export function captureUrl(url: string, options: CaptureOptions, signal?: AbortSignal): Promise<ClientCaptureResult> {
  return queue(async () => {
    if (signal?.aborted) throw new CaptureError('aborted');
    const { width, fullPage, scale, delayMs, hideBanners } = options;
    let res: Response;
    try {
      res = await fetch(CAPTURE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, width, fullPage, scale, delayMs, hideBanners }),
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new CaptureError(signal?.aborted ? 'aborted' : 'network');
    }
    if (!res.ok || !(res.headers.get('Content-Type') || '').startsWith('image/')) {
      const data = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
      const code = isCaptureErrorCode(data?.code) ? data.code : 'failed';
      throw new CaptureError(code, typeof data?.message === 'string' ? data.message : undefined);
    }
    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      throw new CaptureError(signal?.aborted ? 'aborted' : 'network');
    }
    return { blob, trimmed: res.headers.get('X-Capture-Trimmed') === '1', finalUrl: res.headers.get('X-Capture-Url') || url };
  });
}

/* ---------------- recent URLs ---------------- */

/** Most recent first, no duplicates, at most `max`. */
export function pushRecent(list: readonly string[], url: string, max = RECENT_MAX): string[] {
  return [url, ...list.filter((u) => u !== url)].slice(0, max);
}

const canonical = (url: string) => {
  try {
    return new URL(url).href;
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
