import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_REALM, basicAuthOk, gateMissing, proxy } from '@/proxy';

const basic = (userPass: string) => `Basic ${Buffer.from(userPass, 'utf8').toString('base64')}`;

describe('basicAuthOk', () => {
  it('accepts the password with any user name', () => {
    expect(basicAuthOk(basic('jesse:hunter2'), 'hunter2')).toBe(true);
    expect(basicAuthOk(basic(':hunter2'), 'hunter2')).toBe(true);
    expect(basicAuthOk(basic('anyone at all:hunter2'), 'hunter2')).toBe(true);
  });
  it('splits at the first colon, so passwords may contain colons', () => {
    expect(basicAuthOk(basic('jesse:a:b:c'), 'a:b:c')).toBe(true);
    expect(basicAuthOk(basic('jesse:a:b:c'), 'b:c')).toBe(false);
  });
  it('handles non-ASCII passwords as UTF-8', () => {
    expect(basicAuthOk(basic('j:pässwörd ✓'), 'pässwörd ✓')).toBe(true);
    expect(basicAuthOk(basic('j:passwörd'), 'pässwörd')).toBe(false);
  });
  it('is case-insensitive about the scheme and tolerates extra spaces', () => {
    const token = Buffer.from('u:pw').toString('base64');
    expect(basicAuthOk(`basic ${token}`, 'pw')).toBe(true);
    expect(basicAuthOk(`BASIC   ${token}  `, 'pw')).toBe(true);
  });
  it('refuses wrong, partial and longer passwords', () => {
    expect(basicAuthOk(basic('u:hunter3'), 'hunter2')).toBe(false);
    expect(basicAuthOk(basic('u:hunter'), 'hunter2')).toBe(false);
    expect(basicAuthOk(basic('u:hunter22'), 'hunter2')).toBe(false);
    expect(basicAuthOk(basic('u:'), 'hunter2')).toBe(false);
    expect(basicAuthOk(basic('hunter2:'), 'hunter2')).toBe(false); // the password in the user-name slot
  });
  it('refuses missing and malformed headers', () => {
    for (const h of [null, undefined, '', 'Basic', 'Basic ', 'Bearer aHVudGVyMg==', `Digest ${basic('u:pw').slice(6)}`, 'Basic not base64!', 'Basic ' + Buffer.from('no colon').toString('base64')]) {
      expect(basicAuthOk(h, 'pw')).toBe(false);
    }
  });
  it('never matches an empty password', () => {
    expect(basicAuthOk(basic('u:'), '')).toBe(false);
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (auth?: string) => new Request('https://layout-stage.example/api/capture', { method: 'POST', headers: auth ? { authorization: auth } : {} });

  it('lets everything through when ACCESS_PASSWORD is unset or empty', () => {
    vi.stubEnv('ACCESS_PASSWORD', undefined);
    expect(proxy(req())).toBeUndefined();
    vi.stubEnv('ACCESS_PASSWORD', '');
    expect(proxy(req())).toBeUndefined();
  });
  it('asks for the password when it is missing or wrong', async () => {
    vi.stubEnv('ACCESS_PASSWORD', 'hunter2');
    for (const r of [req(), req(basic('u:nope'))]) {
      const res = proxy(r);
      expect(res?.status).toBe(401);
      expect(res?.headers.get('WWW-Authenticate')).toBe(`Basic realm="${ACCESS_REALM}"`);
      expect(res?.headers.get('Cache-Control')).toBe('no-store');
      expect(await res?.text()).toBe('Password required.');
    }
  });
  it('lets the request through with the right password', () => {
    vi.stubEnv('ACCESS_PASSWORD', 'hunter2');
    expect(proxy(req(basic('jesse:hunter2')))).toBeUndefined();
  });
  it('refuses to serve a Vercel production deployment that has no password', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ACCESS_PASSWORD', '');
    const res = proxy(req());
    expect(res?.status).toBe(503);
    expect(res?.headers.get('Cache-Control')).toBe('no-store');
    expect(res?.headers.get('WWW-Authenticate')).toBeNull();
    expect(await res?.text()).toContain('ACCESS_PASSWORD');
  });
  it('serves it open when ACCESS_OPEN is 1', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ACCESS_PASSWORD', '');
    vi.stubEnv('ACCESS_OPEN', '1');
    expect(proxy(req())).toBeUndefined();
    vi.stubEnv('ACCESS_OPEN', 'true');
    expect(proxy(req())?.status).toBe(503);
    vi.stubEnv('ACCESS_OPEN', '0');
    expect(proxy(req())?.status).toBe(503);
  });
  it('previews and local runs stay open without a password', () => {
    vi.stubEnv('ACCESS_PASSWORD', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(proxy(req())).toBeUndefined();
    vi.stubEnv('VERCEL_ENV', undefined);
    expect(proxy(req())).toBeUndefined();
  });
  it('with a password set, production asks for it as before', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('ACCESS_PASSWORD', 'hunter2');
    expect(proxy(req())?.status).toBe(401);
    expect(proxy(req(basic('u:hunter2')))).toBeUndefined();
  });
  it('gateMissing checks production, password and ACCESS_OPEN', () => {
    expect(gateMissing({ VERCEL_ENV: 'production' })).toBe(true);
    expect(gateMissing({ VERCEL_ENV: 'production', ACCESS_PASSWORD: 'pw' })).toBe(false);
    expect(gateMissing({ VERCEL_ENV: 'production', ACCESS_OPEN: '1' })).toBe(false);
    expect(gateMissing({ VERCEL_ENV: 'preview' })).toBe(false);
  });
  it('lets /api/mcp through with the right MCP_TOKEN even when ACCESS_PASSWORD is set', () => {
    const token = '0123456789abcdef0123456789abcdef';
    vi.stubEnv('ACCESS_PASSWORD', 'hunter2');
    vi.stubEnv('MCP_TOKEN', token);
    expect(proxy(new Request(`https://layout-stage.example/api/mcp?key=${token}`, { method: 'POST' }))).toBeUndefined();
    expect(proxy(new Request('https://layout-stage.example/api/mcp?key=wrong', { method: 'POST' }))?.status).toBe(401);
  });
});
