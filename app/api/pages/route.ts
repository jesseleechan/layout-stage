/* POST /api/pages { url, auth? } → { pages: [{ url, title, nav }] }: the pages of a site, for capturing
   a whole template at once. The capture browser reads the start page's menu and the site's sitemap
   (lib/capture/server.ts findSitePages) behind the same guard as a capture; lib/capture/pages.ts makes
   the list. JSON { code, message } on failure. `auth` is used for this request only, never stored. */
import { CREDENTIALS_IN_URL_MESSAGE, hasUrlCredentials, parseAuth } from '@/lib/capture/auth';
import { CaptureError, toCaptureError } from '@/lib/capture/errors';
import { MAX_URL_LENGTH } from '@/lib/capture/options';
import { sitePages } from '@/lib/capture/pages';
import { findSitePages } from '@/lib/capture/server';
import { captureOn } from '@/lib/capture/switch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold start (Chromium download and unpack) plus a slow page.
export const maxDuration = 120;

const NO_STORE = { 'Cache-Control': 'no-store' };

function failure(e: unknown): Response {
  const err = toCaptureError(e);
  if (!(e instanceof CaptureError)) console.error('[pages]', e);
  return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: NO_STORE });
}

/** Only the editor may ask: a JSON body and, when the browser says where the request came from, same-origin. */
function fromEditor(request: Request): boolean {
  const type = request.headers.get('content-type') || '';
  const site = request.headers.get('sec-fetch-site');
  return /^application\/json\b/i.test(type) && (!site || site === 'same-origin' || site === 'none');
}

export async function POST(request: Request): Promise<Response> {
  if (!captureOn()) return failure(new CaptureError('off'));
  if (!fromEditor(request)) return failure(new CaptureError('bad_request'));
  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
    body = raw as Record<string, unknown>;
  } catch {
    return failure(new CaptureError('bad_request'));
  }
  try {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url || url.length > MAX_URL_LENGTH) throw new CaptureError('invalid_url');
    if (hasUrlCredentials(url)) throw new CaptureError('invalid_url', CREDENTIALS_IN_URL_MESSAGE);
    const scan = await findSitePages({ url, auth: parseAuth(body.auth) }, { signal: request.signal });
    return Response.json({ pages: sitePages(scan) }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
