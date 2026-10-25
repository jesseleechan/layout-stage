/* Validates and clamps a capture request body. Shared by the route and its tests. */
import { CAPTURE_WIDTHS, DEFAULT_CAPTURE, type CaptureOptions } from '../model';
import { CaptureError } from './errors';

export const MAX_URL_LENGTH = 2048;
export const MAX_DELAY_MS = 5000;

const WIDTHS = CAPTURE_WIDTHS.map((w) => w.width);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Unknown values fall back to the defaults; numbers are clamped (width snaps to the nearest device). */
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
  };
}

export interface CaptureRequest extends CaptureOptions {
  url: string;
}

/** Parses `{ url, width, fullPage, scale, delayMs, hideBanners }`. Throws CaptureError. */
export function parseCaptureRequest(body: unknown): CaptureRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CaptureError('bad_request');
  const raw = body as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url || url.length > MAX_URL_LENGTH) throw new CaptureError('invalid_url');
  return { url, ...clampOptions(raw) };
}
