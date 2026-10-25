/* POST /api/capture { url, width, fullPage, scale, delayMs, hideBanners } → the capture as one image
   (image/png, or image/webp when hosted and the PNG would be over the host's response cap), or as
   multipart/form-data with one "part" per WebP slice, top to bottom, which the client joins; JSON
   { code, message } on failure. Drives a real browser, so it runs on Node and is never cached. */
import { CaptureError, toCaptureError } from '@/lib/capture/errors';
import { parseCaptureRequest } from '@/lib/capture/options';
import { captureScreenshot, responseBudget } from '@/lib/capture/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold start on Vercel (Chromium download and unpack), a slow page and WebP re-encoding on one
// vCPU can add up; 300 s is the Hobby plan's maximum.
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

function failure(e: unknown): Response {
  const err = toCaptureError(e);
  if (!(e instanceof CaptureError)) console.error('[capture]', e);
  return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: NO_STORE });
}

/** Only the editor itself may start captures: a JSON body (which a cross-site page can't send without
 *  a CORS preflight that fails) and, when the browser says where the request came from, same-origin. */
function fromEditor(request: Request): boolean {
  const type = request.headers.get('content-type') || '';
  const site = request.headers.get('sec-fetch-site');
  return /^application\/json\b/i.test(type) && (!site || site === 'same-origin' || site === 'none');
}

const bytes = (b: Buffer) => new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

export async function POST(request: Request): Promise<Response> {
  if (!fromEditor(request)) return failure(new CaptureError('bad_request'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(new CaptureError('bad_request'));
  }
  try {
    const input = parseCaptureRequest(body);
    const { images, trimmed, finalUrl } = await captureScreenshot(input, { signal: request.signal, maxBytes: responseBudget() });
    const headers = {
      ...NO_STORE,
      'X-Capture-Trimmed': trimmed ? '1' : '0',
      'X-Capture-Url': /^[\x21-\x7e]+$/.test(finalUrl) ? finalUrl : encodeURI(finalUrl),
    };
    if (images.length === 1) {
      const [{ type, data }] = images;
      return new Response(bytes(data), { headers: { ...headers, 'Content-Type': type, 'Content-Length': String(data.byteLength) } });
    }
    const form = new FormData();
    images.forEach(({ type, data }, i) => form.append('part', new Blob([bytes(data)], { type }), `part-${i + 1}.${type.split('/')[1]}`));
    return new Response(form, { headers });
  } catch (e) {
    return failure(e);
  }
}
