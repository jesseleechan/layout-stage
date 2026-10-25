import { describe, expect, it } from 'vitest';
import { looksBlocked, navError, pageError } from '@/lib/capture/detect';
import { CAPTURE_MESSAGES, CaptureError } from '@/lib/capture/errors';
import { clampOptions, parseCaptureRequest } from '@/lib/capture/options';
import { createSerialQueue } from '@/lib/capture/queue';
import { bypassesProxy, parseAuthority, upstreamFromEnv } from '@/lib/capture/guard-proxy';

describe('parseCaptureRequest', () => {
  it('passes valid input through', () => {
    expect(parseCaptureRequest({ url: ' https://example.com ', width: 390, fullPage: false, scale: 1, delayMs: 0, hideBanners: false })).toEqual({
      url: 'https://example.com', width: 390, fullPage: false, scale: 1, delayMs: 0, hideBanners: false,
    });
  });
  it('fills defaults and clamps', () => {
    expect(parseCaptureRequest({ url: 'https://example.com' })).toEqual({
      url: 'https://example.com', width: 1440, fullPage: true, scale: 2, delayMs: 1500, hideBanners: true,
    });
    expect(clampOptions({ width: 1300, scale: 3, delayMs: 99999, fullPage: 'no', hideBanners: 1 })).toEqual({
      width: 1280, fullPage: true, scale: 2, delayMs: 5000, hideBanners: true,
    });
    expect(clampOptions({ width: 100, scale: 0.5, delayMs: -4 })).toMatchObject({ width: 390, scale: 1, delayMs: 0 });
    expect(clampOptions({ width: 800, delayMs: 1234.6 })).toMatchObject({ width: 834, delayMs: 1235 });
    expect(clampOptions({ width: Number.NaN, delayMs: Infinity })).toMatchObject({ width: 1440, delayMs: 1500 });
  });
  it('refuses missing or oversized URLs and non-objects', () => {
    for (const body of [null, 'https://example.com', [], {}, { url: 42 }, { url: '   ' }, { url: 'https://e.com/' + 'a'.repeat(3000) }]) {
      expect(() => parseCaptureRequest(body)).toThrow(CaptureError);
    }
  });
});

describe('bot walls', () => {
  it('spots challenge pages whatever the status', () => {
    expect(looksBlocked(403, 'Just a moment...', '<html>…</html>')).toBe(true);
    expect(looksBlocked(200, 'Just a moment...', '')).toBe(true);
    expect(looksBlocked(503, '', '<script>window._cf_chl_opt={}</script>')).toBe(true);
    expect(looksBlocked(403, '', '<script src="https://geo.captcha-delivery.com/captcha/"></script>')).toBe(true);
    expect(looksBlocked(200, 'Access to this page has been denied', '<div id="px-captcha"></div>')).toBe(true);
    expect(looksBlocked(403, 'Access Denied', 'You don’t have permission … Reference #18.abc https://errors.edgesuite.net/18.abc')).toBe(true);
    expect(looksBlocked(200, 'Pardon Our Interruption', '')).toBe(true);
  });
  it('treats 429 and captcha-on-403 as blocked', () => {
    expect(looksBlocked(429, 'Too Many Requests', '')).toBe(true);
    expect(looksBlocked(403, 'Forbidden', '<div class="g-recaptcha"></div>')).toBe(true);
  });
  it('leaves normal pages alone', () => {
    expect(looksBlocked(200, 'Contact us', '<form><div class="g-recaptcha"></div></form><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>')).toBe(false);
    expect(looksBlocked(404, 'Not found', '<h1>Page not found</h1>')).toBe(false);
    expect(looksBlocked(503, 'Down for maintenance', '<p>Back soon</p>')).toBe(false);
  });
  it('maps status codes to messages', () => {
    expect(pageError(200, 'Home', '<h1>Hi</h1>')).toBeNull();
    expect(pageError(404, 'Not found', '')?.message).toBe('That page returned an error (404). Check the address and try again.');
    expect(pageError(403, 'Just a moment...', '')?.message).toBe('This site blocks automated browsers. Take a screenshot and drop it in instead.');
  });
});

describe('navError', () => {
  const err = (msg: string, name = 'Error') => Object.assign(new Error(msg), { name });
  it.each([
    [err('page.goto: Timeout 30000ms exceeded.', 'TimeoutError'), 'timeout'],
    [err('page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.example/'), 'unreachable'],
    [err('page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/'), 'unreachable'],
    [err('page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self-signed.example/'), 'insecure'],
    [err('page.goto: net::ERR_TOO_MANY_REDIRECTS at https://loop.example/'), 'http_error'],
    [err("browserType.launch: Executable doesn't exist at /x/chrome-linux/headless_shell"), 'no_browser'],
    [err('something odd'), 'failed'],
  ])('%s → %s', (e, code) => expect(navError(e).code).toBe(code));

  it('keeps the handoff wording', () => {
    expect(navError(err('Timeout 30000ms exceeded.', 'TimeoutError')).message).toBe(CAPTURE_MESSAGES.timeout);
    expect(CAPTURE_MESSAGES.timeout).toBe('That page didn’t finish loading in 30 seconds. Try First screen or a longer delay.');
    expect(CAPTURE_MESSAGES.no_browser).toBe('The capture browser isn’t installed. Run npx playwright install chromium.');
  });
});

describe('createSerialQueue', () => {
  it('runs one task at a time, in order, and survives failures', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    let running = 0;
    const task = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((res, rej) => {
        running++;
        expect(running).toBe(1);
        log.push(`start ${name}`);
        setTimeout(() => {
          running--;
          log.push(`end ${name}`);
          if (fail) rej(new Error(name));
          else res(name);
        }, ms);
      });
    const results = await Promise.allSettled([queue(task('a', 20)), queue(task('b', 5, true)), queue(task('c', 1))]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});

describe('guard proxy helpers', () => {
  it('reads the upstream proxy from the environment', () => {
    const up = upstreamFromEnv({ HTTPS_PROXY: 'http://127.0.0.1:8080', NO_PROXY: 'localhost, .svc.local,*.corp.example,pypi.org' });
    expect(up.https?.href).toBe('http://127.0.0.1:8080/');
    expect(up.http).toBeUndefined();
    expect(up.noProxy).toEqual(['localhost', '.svc.local', '*.corp.example', 'pypi.org']);
    expect(upstreamFromEnv({ https_proxy: 'proxy.example:3128', http_proxy: 'http://q:2' })).toMatchObject({
      https: new URL('http://proxy.example:3128'),
      http: new URL('http://q:2'),
    });
    expect(upstreamFromEnv({})).toEqual({ https: undefined, http: undefined, noProxy: [] });
  });
  it('matches NO_PROXY entries', () => {
    const list = ['pypi.org', '.svc.local', '*.corp.example'];
    expect(bypassesProxy('pypi.org', list)).toBe(true);
    expect(bypassesProxy('files.pypi.org', list)).toBe(false);
    expect(bypassesProxy('a.svc.local', list)).toBe(true);
    expect(bypassesProxy('svc.local', list)).toBe(true);
    expect(bypassesProxy('x.corp.example', list)).toBe(true);
    expect(bypassesProxy('example.com', list)).toBe(false);
    expect(bypassesProxy('anything', ['*'])).toBe(true);
  });
  it('parses CONNECT authorities', () => {
    expect(parseAuthority('example.com:443')).toEqual({ host: 'example.com', port: 443 });
    expect(parseAuthority('[2606:4700::1]:443')).toEqual({ host: '[2606:4700::1]', port: 443 });
    expect(parseAuthority('1.2.3.4:80')).toEqual({ host: '1.2.3.4', port: 80 });
    for (const a of ['example.com', 'example.com:0', 'example.com:70000', '[::1:443', 'a b:443', 'http://x:1']) expect(parseAuthority(a)).toBeNull();
  });
});
