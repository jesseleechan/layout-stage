/* End-to-end capture against a local origin, offline: real Chromium, the guard proxy and the
   request guard. A test policy plays DNS: public.test → the local origin, internal.test → private. */
import http from 'node:http';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { captureScreenshot, shutdownCapture, TOO_LARGE_MESSAGE, type CaptureImage, type CaptureInput } from '@/lib/capture/server';
import { joinImages } from '@/lib/capture/client';
import { startGuardProxy } from '@/lib/capture/guard-proxy';
import { CaptureError } from '@/lib/capture/errors';
import { createRequestGuard, type HostPolicy } from '@/lib/capture/url-guard';

const hasBrowser = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const policy: HostPolicy = async (host) =>
  host === 'public.test' ? { verdict: 'ok', addresses: ['127.0.0.1'] } : host === 'internal.test' ? { verdict: 'private', addresses: [] } : { verdict: 'unresolved', addresses: [] };

let origin: http.Server;
let port = 0;
const hits: string[] = [];
const pub = (p: string) => `http://public.test:${port}${p}`;
const internal = (p: string) => `http://internal.test:${port}${p}`;

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const html = (body: string, title = 'Test page') =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#fff;font:16px sans-serif}</style></head><body>${body}</body></html>`;

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = (req.url ?? '/').replace(/^https?:\/\/[^/]+/, '');
  hits.push(`${req.headers.host} ${path}`);
  const send = (status: number, body: string | Buffer, type = 'text/html', extra: http.OutgoingHttpHeaders = {}) => {
    res.writeHead(status, { 'Content-Type': type, ...extra });
    res.end(body);
  };
  switch (path) {
    case '/redirect-internal':
      return send(302, '', 'text/plain', { Location: internal('/secret') });
    case '/redirect-public':
      return send(302, '', 'text/plain', { Location: pub('/page') });
    case '/redirect-img':
      return send(302, '', 'text/plain', { Location: internal('/secret.png') });
    case '/page':
      return send(
        200,
        html(`<h1 style="height:1200px;margin:0;background:#1b2244;color:#fff">Hello</h1>
          <img src="${internal('/secret.png')}" width="10" height="10"><img src="/redirect-img" width="10" height="10">
          <iframe src="${internal('/secret')}"></iframe>
          <div id="onetrust-banner-sdk" style="position:fixed;left:0;right:0;bottom:0;height:200px;background:rgb(255,0,0)">We use cookies</div>
          <script>fetch(${JSON.stringify(internal('/secret'))}).catch(() => {});</script>`),
      );
    case '/tall':
      return send(200, html('<div style="height:15000px;background:linear-gradient(#fff,#3a48f0)"></div>'));
    case '/noisy': // 7000 px tall; the first screen is noise, which PNG can't compress and WebP can
      return send(
        200,
        html(`<canvas id="c" width="390" height="900" style="display:block"></canvas><div style="height:6100px;background:#3a48f0"></div>
          <script>
            const c = document.getElementById('c').getContext('2d'), d = c.createImageData(390, 900);
            let s = 7;
            for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : 100 + ((((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 255) >> 3);
            c.putImageData(d, 0, 0);
          </script>`),
      );
    case '/js-redirect':
      return send(200, html(`<p>moving</p><script>setTimeout(() => { location.href = ${JSON.stringify(internal('/secret'))}; }, 50);</script>`));
    case '/missing':
      return send(404, html('<h1>Not here</h1>', 'Not found'));
    case '/challenge':
      return send(403, html('<p>Checking your browser…</p>', 'Just a moment...'));
    case '/secret':
      return send(200, 'SECRET', 'text/plain');
    case '/secret.png':
      return send(200, PNG_1PX, 'image/png');
    default:
      return send(404, 'nope', 'text/plain');
  }
}

const opts = (url: string, o: Partial<CaptureInput> = {}): CaptureInput => ({ url, width: 1440, fullPage: true, scale: 1, delayMs: 0, hideBanners: true, ...o });
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const onePng = (images: CaptureImage[]) => {
  expect(images.map((i) => i.type)).toEqual(['image/png']);
  return images[0].data;
};
const secretHits = () => hits.filter((h) => h.includes('/secret'));

async function rejection(p: Promise<unknown>): Promise<CaptureError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CaptureError) return e;
    throw e;
  }
  throw new Error('expected a CaptureError');
}

describe.skipIf(!hasBrowser)('capture in a real browser (offline)', () => {
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy };
  let decoder: Browser;

  /** Reads pixels from a PNG with the browser's own decoder. */
  async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
    const page = await decoder.newPage();
    try {
      return await page.evaluate(
        async ({ src, x, y }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        },
        { src: `data:image/png;base64,${png.toString('base64')}`, x, y },
      );
    } finally {
      await page.close();
    }
  }

  beforeAll(async () => {
    delete process.env.HTTP_PROXY; // plain-http test origin, reached directly by the guard proxy
    delete process.env.http_proxy;
    origin = http.createServer(serve);
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
    port = (origin.address() as net.AddressInfo).port;
    decoder = await chromium.launch();
  });

  afterAll(async () => {
    await shutdownCapture();
    await decoder?.close();
    await new Promise((r) => origin.close(r));
    Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v != null)));
  });

  it('captures a full page, hides the cookie banner and never touches internal hosts', async () => {
    hits.length = 0;
    const { images, trimmed, finalUrl } = await captureScreenshot(opts(pub('/redirect-public')), { policy });
    const png = onePng(images);
    expect(finalUrl).toBe(pub('/page'));
    expect(trimmed).toBe(false);
    const [w, h] = size(png);
    expect(w).toBe(1440);
    expect(h).toBeGreaterThan(1200); // the whole page, not just the first screen
    expect(await pixel(png, 700, 850)).toEqual([27, 34, 68]); // the h1 colour where the red banner was
    expect(secretHits()).toEqual([]);
  }, 60_000);

  it('refuses a public URL that redirects to an internal one', async () => {
    hits.length = 0;
    const err = await rejection(captureScreenshot(opts(pub('/redirect-internal')), { policy }));
    expect(err.code).toBe('private');
    expect(err.message).toBe('Only public web addresses can be captured.');
    expect(hits).toEqual([`public.test:${port} /redirect-internal`]);
  }, 60_000);

  it('refuses a page that navigates itself to an internal host', async () => {
    hits.length = 0;
    const err = await rejection(captureScreenshot(opts(pub('/js-redirect'), { delayMs: 500 }), { policy }));
    expect(err.code).toBe('private');
    expect(secretHits()).toEqual([]);
  }, 60_000);

  it('trims very long pages at 12,000 CSS px', async () => {
    const { images, trimmed } = await captureScreenshot(opts(pub('/tall'), { width: 834 }), { policy });
    const png = onePng(images);
    expect(trimmed).toBe(true);
    expect(size(png)).toEqual([834, 12000]);
  }, 60_000);

  it('takes a 2× phone first screen', async () => {
    const { images, trimmed } = await captureScreenshot(opts(pub('/tall'), { width: 390, fullPage: false, scale: 2 }), { policy });
    const png = onePng(images);
    expect(trimmed).toBe(false);
    expect(size(png)).toEqual([780, 1800]);
  }, 60_000);

  it('sends WebP slices when the PNG is over the byte budget, which the client joins', async () => {
    const page = opts(pub('/noisy'), { width: 390 });
    const png = onePng((await captureScreenshot(page, { policy })).images);
    expect(size(png)).toEqual([390, 7000]);
    const maxBytes = Math.floor(png.length * 0.6);
    const { images } = await captureScreenshot(page, { policy, maxBytes });
    expect(images.map((i) => i.type)).toEqual(['image/webp', 'image/webp']); // 6000 + 1000 px
    expect(images.reduce((n, i) => n + i.data.length, 0)).toBeLessThanOrEqual(maxBytes);

    const tab = await decoder.newPage();
    try {
      const joined = await tab.evaluate(
        async ({ join, parts }) => {
          const joinImages = new Function(`return (${join})`)() as (parts: Blob[]) => Promise<Blob>;
          const blob = await joinImages(parts.map((b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/webp' })));
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          return { type: blob.type, width: bitmap.width, height: bitmap.height, blue: Array.from(ctx.getImageData(200, 6500, 1, 1).data.slice(0, 3)) };
        },
        { join: joinImages.toString(), parts: images.map((i) => i.data.toString('base64')) },
      );
      expect(joined).toMatchObject({ type: 'image/png', width: 390, height: 7000 });
      joined.blue.forEach((v, i) => expect(Math.abs(v - [0x3a, 0x48, 0xf0][i])).toBeLessThanOrEqual(3)); // the second slice, in place
    } finally {
      await tab.close();
    }
  }, 90_000);

  it('gives up with a clear message when even WebP is over the budget', async () => {
    const err = await rejection(captureScreenshot(opts(pub('/noisy'), { width: 390, fullPage: false }), { policy, maxBytes: 1000 }));
    expect(err.message).toBe(TOO_LARGE_MESSAGE);
  }, 90_000);

  it('reports error pages and bot walls', async () => {
    const missing = await rejection(captureScreenshot(opts(pub('/missing')), { policy }));
    expect(missing.message).toBe('That page returned an error (404). Check the address and try again.');
    const wall = await rejection(captureScreenshot(opts(pub('/challenge')), { policy }));
    expect(wall.code).toBe('blocked');
  }, 60_000);

  it('refuses unknown and internal hosts before opening anything', async () => {
    expect((await rejection(captureScreenshot(opts(internal('/secret')), { policy }))).code).toBe('private');
    expect((await rejection(captureScreenshot(opts('http://nowhere.test/'), { policy }))).code).toBe('unreachable');
  }, 60_000);
});

describe('guard proxy', () => {
  let proxy: Awaited<ReturnType<typeof startGuardProxy>>;
  beforeAll(async () => {
    origin = http.createServer(serve);
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
    port = (origin.address() as net.AddressInfo).port;
    proxy = await startGuardProxy(createRequestGuard(policy), { noProxy: [] });
  });
  afterAll(async () => {
    await proxy.close();
    await new Promise((r) => origin.close(r));
  });

  /** Sends a raw request to the proxy and returns the first response line. */
  function raw(request: string, then?: string): Promise<string> {
    const { port: pp } = new URL(proxy.url);
    return new Promise((resolve, reject) => {
      const s = net.connect(Number(pp), '127.0.0.1');
      let buf = '';
      let sent = false;
      s.on('data', (d) => {
        buf += d.toString('latin1');
        if (then && !sent && buf.includes('\r\n\r\n')) {
          if (!buf.startsWith('HTTP/1.1 200')) return resolve(buf.split('\r\n')[0]);
          sent = true;
          buf = '';
          s.write(then);
        } else if (buf.includes('\r\n\r\n') && (!then || sent)) {
          resolve(buf.split('\r\n')[0] + (buf.includes('SECRET') ? ' SECRET' : ''));
          s.destroy();
        }
      });
      s.on('error', reject);
      s.write(request);
    });
  }

  it('tunnels CONNECT to allowed hosts only', async () => {
    const get = `GET /secret HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n`;
    expect(await raw(`CONNECT public.test:${port} HTTP/1.1\r\nHost: public.test:${port}\r\n\r\n`, get)).toBe('HTTP/1.1 200 OK SECRET');
    expect(await raw(`CONNECT internal.test:${port} HTTP/1.1\r\nHost: internal.test:${port}\r\n\r\n`, get)).toBe('HTTP/1.1 403 Forbidden');
    expect(await raw(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`, get)).toBe('HTTP/1.1 403 Forbidden');
  });

  it('forwards plain http to allowed hosts only', async () => {
    expect(await raw(`GET ${pub('/secret')} HTTP/1.1\r\nHost: public.test:${port}\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 200 OK SECRET');
    expect(await raw(`GET ${internal('/secret')} HTTP/1.1\r\nHost: internal.test:${port}\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 403 Forbidden');
    expect(await raw(`GET http://[::1]:${port}/secret HTTP/1.1\r\nHost: [::1]\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 403 Forbidden');
  });
});
