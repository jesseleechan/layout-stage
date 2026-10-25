/* Validates and clamps a capture request body. Shared by the route and its tests. */
import { CAPTURE_WIDTHS, DEFAULT_CAPTURE, type CaptureOptions } from '../model';
import { CREDENTIALS_IN_URL_MESSAGE, hasUrlCredentials, parseAuth, type CaptureAuth } from './auth';
import { CaptureError } from './errors';
import { cleanSelectors, parseSelectors } from './selectors';

export const MAX_URL_LENGTH = 2048;
export const MAX_DELAY_MS = 5000;

const WIDTHS = CAPTURE_WIDTHS.map((w) => w.width);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Unknown values fall back to the defaults; numbers are clamped (width snaps to the nearest device);
 *  hideSelectors keeps the entries that are selectors. */
export function clampOptions(raw: Record<string, unknown>): CaptureOptions {
  const w = num(raw.width);
  const s = num(raw.scale);
  const d = num(raw.delayMs);
  return {
    width: w == null ? DEFAULT_CAPTURE.width : WIDTHS.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best)),
    fullPage: typeof raw.fullPage === 'boolean' ? raw.fullPage : DEFAULT_CAPTURE.fullPage,
    scale: s == null ? DEFAULT_CAPTURE.scale : s >= 1.5 ? 2 : 1,
    delayMs: d == null ? DEFAULT_CAPTURE.delayMs : Math.round(Math.min(MAX_DELAY_MS, Math.max(0, d))),
    hideBanners: typeof raw.hideBanners === 'boolean' ? raw.hideBanners : DEFAULT_CAPTURE.hideBanners,
    darkMode: typeof raw.darkMode === 'boolean' ? raw.darkMode : DEFAULT_CAPTURE.darkMode,
    hideSelectors: cleanSelectors(raw.hideSelectors),
  };
}

export interface CaptureRequest extends CaptureOptions {
  url: string;
  /** Basic-auth credentials for this request only; null when none were given. */
  auth: CaptureAuth | null;
}

/** Parses `{ url, width, fullPage, scale, delayMs, hideBanners, darkMode, hideSelectors, auth }`.
 *  Throws CaptureError. hideSelectors, when given, must be a selector list (a string or strings). */
export function parseCaptureRequest(body: unknown): CaptureRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CaptureError('bad_request');
  const raw = body as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url || url.length > MAX_URL_LENGTH) throw new CaptureError('invalid_url');
  if (hasUrlCredentials(url)) throw new CaptureError('invalid_url', CREDENTIALS_IN_URL_MESSAGE);
  const sel = raw.hideSelectors;
  if (sel != null) {
    const list = typeof sel === 'string' ? sel : Array.isArray(sel) && sel.every((x) => typeof x === 'string') ? (sel as string[]) : null;
    const parsed = list == null ? null : parseSelectors(list);
    if (!parsed?.ok) throw new CaptureError('bad_selectors', parsed?.message);
  }
  return { url, ...clampOptions(raw), auth: parseAuth(raw.auth) };
}
