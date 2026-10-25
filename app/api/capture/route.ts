/* POST /api/capture { url, width, fullPage, scale, delayMs, hideBanners } → image/png, or JSON
   { code, message } on failure. Drives a real browser, so it runs on Node and is never cached. */
import { CaptureError, toCaptureError } from '@/lib/capture/errors';
import { parseCaptureRequest } from '@/lib/capture/options';
import { captureScreenshot } from '@/lib/capture/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NO_STORE = { 'Cache-Control': 'no-store' };

function failure(e: unknown): Response {
  const err = toCaptureError(e);
  if (!(e instanceof CaptureError)) console.error('[capture]', e);
  return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(new CaptureError('bad_request'));
  }
  try {
    const input = parseCaptureRequest(body);
    const { png, trimmed, finalUrl } = await captureScreenshot(input, { signal: request.signal });
    return new Response(new Uint8Array(png.buffer as ArrayBuffer, png.byteOffset, png.byteLength), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'X-Capture-Trimmed': trimmed ? '1' : '0',
        'X-Capture-Url': /^[\x21-\x7e]+$/.test(finalUrl) ? finalUrl : encodeURI(finalUrl),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
