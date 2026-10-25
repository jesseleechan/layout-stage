import { describe, expect, it } from 'vitest';
import { captureName, normalizeUrl, precheckUrl, pushRecent, RECENT_MAX } from '@/lib/capture/client';

describe('normalizeUrl', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  example.com/pricing  ', 'https://example.com/pricing'],
    ['www.example.com:8080/a?b=1', 'https://www.example.com:8080/a?b=1'],
    ['localhost:3000', 'https://localhost:3000'],
    ['//example.com/x', 'https://example.com/x'],
    ['http://example.com', 'http://example.com'],
    ['HTTPS://Example.com/A', 'HTTPS://Example.com/A'],
    ['ftp://example.com', 'ftp://example.com'],
    ['mailto:hi@example.com', 'mailto:hi@example.com'],
    ['', ''],
    ['   ', ''],
  ])('%j → %j', (input, out) => expect(normalizeUrl(input)).toBe(out));
});

describe('precheckUrl', () => {
  it('passes public addresses', () => {
    expect(precheckUrl('https://example.com/pricing')).toBeNull();
  });
  it('refuses private ones with the public-address message', () => {
    for (const u of ['https://localhost:3000', 'http://192.168.1.1', 'http://169.254.169.254', 'http://0x7f.1']) {
      expect(precheckUrl(u)?.message).toBe('Only public web addresses can be captured.');
    }
  });
  it('explains other schemes and broken addresses', () => {
    expect(precheckUrl('ftp://example.com')?.code).toBe('invalid_url');
    expect(precheckUrl('ftp://example.com')?.message).toMatch(/http:\/\/ or https:\/\//);
    expect(precheckUrl('https://exa mple.com')?.code).toBe('invalid_url');
  });
});

describe('captureName', () => {
  it.each([
    ['https://example.com', 'example.com'],
    ['https://example.com/', 'example.com'],
    ['https://example.com/pricing', 'example.com/pricing'],
    ['https://example.com/pricing/', 'example.com/pricing'],
    ['https://example.com/pricing?plan=pro#faq', 'example.com/pricing'],
    ['https://www.example.com/a/b/', 'www.example.com/a/b'],
    ['https://example.com:8443/shop', 'example.com/shop'],
    ['https://example.com/caf%C3%A9', 'example.com/café'],
    ['https://Example.COM/About', 'example.com/About'],
  ])('%s → %s', (url, name) => expect(captureName(url)).toBe(name));

  it('falls back to the input when it is not a URL', () => {
    expect(captureName('not a url')).toBe('not a url');
  });
});

describe('pushRecent', () => {
  it('puts the newest first and removes duplicates', () => {
    expect(pushRecent(['https://a.com/', 'https://b.com/'], 'https://b.com/')).toEqual(['https://b.com/', 'https://a.com/']);
    expect(pushRecent([], 'https://a.com/')).toEqual(['https://a.com/']);
  });
  it('keeps the last 10', () => {
    const list = Array.from({ length: RECENT_MAX }, (_, i) => `https://site${i}.com/`);
    const next = pushRecent(list, 'https://new.com/');
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('https://new.com/');
    expect(next).not.toContain('https://site9.com/');
  });
});
