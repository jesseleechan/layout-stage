import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_REALM, basicAuthOk, proxy } from '@/proxy';

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
});
