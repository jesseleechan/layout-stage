/* Shared bits of the /api/projects routes. Server only. */
import { BadRequest } from './api';

export const NO_STORE = { 'Cache-Control': 'no-store' };

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: NO_STORE });

export const failure = (status: number, code: string, message: string) => json({ code, message }, status);

export const syncOff = () => failure(503, 'sync_off', 'Sync is off on this server.');

/** Changes may only come from the editor itself: when the browser says where a request came from,
 *  it must be this site (a cross-site page can't send these without a CORS preflight anyway). */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin' || site === 'none';
}

export const isJson = (request: Request) => /^application\/json\b/i.test(request.headers.get('content-type') || '');

/** Maps an error to a response; unexpected ones are logged (never with credentials: the Blob SDK's
 *  errors carry codes and messages, not tokens). */
export function fromError(e: unknown): Response {
  if (e instanceof BadRequest) return failure(400, 'bad_request', e.message);
  console.error('[projects]', e instanceof Error ? `${e.name}: ${e.message}` : e);
  return failure(502, 'store_error', 'The project store didn’t answer. Try again in a moment.');
}

/** Reads a JSON body of at most `max` bytes. */
export async function readJsonBody(request: Request, max: number): Promise<unknown> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) throw new BadRequest('That request is too big.');
  const text = await request.text();
  if (text.length > max) throw new BadRequest('That request is too big.');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('Expected JSON.');
  }
}
