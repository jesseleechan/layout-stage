/* Capture options added for re-capture: hide-elements selectors, basic-auth credentials, how a
   re-captured layout keeps its framing, where desktop + phone captures land, and what gets stored. */
import { describe, expect, it } from 'vitest';
import { arrange, defaultComposition } from '@/lib/arrange';
import { clone, DEFAULT_CAPTURE, sampleSlot, type Composition, type Slot } from '@/lib/model';
import { cleanSelectors, isSelectorShaped, parseSelectors, selectorCss, splitSelectors, MAX_SELECTORS } from '@/lib/capture/selectors';
import { authProblem, basicHeader, hasUrlCredentials, parseAuth, redactAuth, splitUrlCredentials } from '@/lib/capture/auth';
import { dropSlot, pairOptions, pairTarget, recapturable, reframe } from '@/lib/capture/recapture';
import { captureBody, canonical } from '@/lib/capture/client';
import { sanitizeComposition } from '@/lib/persist';
import { coverSource, cropRatio } from '@/lib/render/units';

describe('hide elements: selectors', () => {
  it('splits on new lines and on top-level commas only', () => {
    expect(splitSelectors('#chat, .promo-bar\n  .sticky  \n\n#chat')).toEqual(['#chat', '.promo-bar', '.sticky']);
    expect(splitSelectors(':is(.a, .b) > p, [data-x="a,b"], .c')).toEqual([':is(.a, .b) > p', '[data-x="a,b"]', '.c']);
    expect(splitSelectors('  ,, \n')).toEqual([]);
  });

  it.each([
    '#chat-widget', '.promo.bar', 'div > .x + .y ~ p', '[data-testid="cookie"]', 'a[href^="https://example.com/pricing"]',
    ':is(.a, .b)', 'li:nth-child(2n+1)', '.café', '*', 'svg|rect', '[aria-label=\'Close dialog\']', 'iframe[src*="intercom"]',
  ])('accepts %s', (sel) => expect(isSelectorShaped(sel)).toBe(true));

  it.each([
    'div { color: red }', '#a; body', '[aria-label="a;b"]', '@import url(x)', '</style><script>alert(1)</script>', '.a\\7b', 'a/*x*/', '.a/b',
    '.x[', '.x)', '(.x', '.x"', '"quoted"', 'a\u0000b', '.a !important', '100%', 'x'.repeat(201), '',
  ])('refuses %j', (sel) => expect(isSelectorShaped(sel)).toBe(false));

  it('parses what was typed, with a message for the first problem', () => {
    expect(parseSelectors('#chat\n.promo')).toEqual({ ok: true, selectors: ['#chat', '.promo'] });
    const bad = parseSelectors('#ok, div { display: block }');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message).toMatch(/^“div \{ display: block \}” isn’t a CSS selector\./);
    expect(parseSelectors(Array.from({ length: MAX_SELECTORS + 1 }, (_, i) => `.s${i}`).join(',')).ok).toBe(false);
    expect(parseSelectors('.a,'.repeat(700)).ok).toBe(false); // over 2,000 characters
  });

  it('cleans stored or posted values leniently', () => {
    expect(cleanSelectors(['#a', 'b{', 3, '.c, .d'])).toEqual(['#a', '.c', '.d']);
    expect(cleanSelectors('#a\n.b')).toEqual(['#a', '.b']);
    expect(cleanSelectors(undefined)).toEqual([]);
    expect(cleanSelectors({ x: 1 })).toEqual([]);
  });

  it('writes one display:none rule per selector, and nothing else', () => {
    expect(selectorCss(['#chat', '.a, .b'])).toBe('#chat { display: none !important; }\n.a, .b { display: none !important; }');
    expect(selectorCss(['x{}', '#ok'])).toBe('#ok { display: none !important; }');
    expect(selectorCss([])).toBe('');
  });
});

describe('basic auth credentials', () => {
  it('validates what can be sent', () => {
    expect(authProblem({ username: 'jesse', password: 'p:@ss word' })).toBeNull();
    expect(authProblem({ username: 'je:sse', password: 'x' })).toMatch(/colon/);
    expect(authProblem({ username: 'jesse', password: 'a\nb' })).toMatch(/can’t be sent/);
    expect(parseAuth(undefined)).toBeNull();
    expect(parseAuth({ username: '', password: '' })).toBeNull();
  });

  it('moves credentials out of a typed address', () => {
    expect(splitUrlCredentials('https://jesse:p%40ss@staging.example.com/shop?x=1')).toEqual({
      url: 'https://staging.example.com/shop?x=1',
      auth: { username: 'jesse', password: 'p@ss' },
    });
    expect(splitUrlCredentials('https://example.com/a')).toEqual({ url: 'https://example.com/a', auth: null });
    expect(splitUrlCredentials('not a url')).toEqual({ url: 'not a url', auth: null });
    expect(hasUrlCredentials('https://a:b@example.com')).toBe(true);
    expect(hasUrlCredentials('https://example.com/@me')).toBe(false);
  });

  it('builds the header browsers send (UTF-8) and blanks it all out of log text', () => {
    const auth = { username: 'jösse', password: 'Stag1ng-s3cret' };
    expect(basicHeader(auth)).toBe(`Basic ${Buffer.from('jösse:Stag1ng-s3cret', 'utf8').toString('base64')}`);
    const text = `failed for jösse with Stag1ng-s3cret (Authorization: ${basicHeader(auth)})`;
    const out = redactAuth(text, auth);
    expect(out).not.toMatch(/jösse|Stag1ng|s3cret/);
    expect(out).not.toContain(basicHeader(auth).slice(6));
    expect(redactAuth(text, null)).toBe(text);
  });

  it('never puts credentials in the request body unless given, nor in remembered URLs', () => {
    const body = JSON.parse(captureBody('https://example.com', DEFAULT_CAPTURE));
    expect(body).not.toHaveProperty('auth');
    expect(body).toMatchObject({ darkMode: false, hideSelectors: [] });
    expect(JSON.parse(captureBody('https://example.com', DEFAULT_CAPTURE, { username: 'a', password: 'b' })).auth).toEqual({ username: 'a', password: 'b' });
    expect(canonical('https://jesse:pw@staging.example.com/x')).toBe('https://staging.example.com/x');
  });
});

/** A 1440-wide full-page capture at 1×, cropped 16:10, 700 canvas px wide. */
function captured(nh: number, fy: number, extra: Partial<Slot> = {}): Slot {
  return { ...sampleSlot(0), nw: 1440, nh, crop: '16:10', fx: 50, fy, cx: 420, cy: 610, w: 700, ...extra };
}
/** Where the visible window starts, in page px at 1440 wide. */
const windowTop = (s: Slot) => (coverSource(s.nw, s.nh, s.w, s.w / cropRatio(s), s.fx, s.fy).sy * 1440) / s.nw;

describe('re-capture keeps the framing', () => {
  it('keeps everything when the page is the same size', () => {
    const prev = captured(4000, 37.5);
    expect(reframe(prev, prev, 1500)).toEqual({ crop: '16:10', fx: 50, fy: 37.5, cx: 420, cy: 610, w: 700 });
  });

  it('keeps the same part of a page that grew', () => {
    const prev = captured(4000, 50); // window top at 1550 px
    const next = reframe(prev, { nw: 1440, nh: 6000 }, 1500);
    expect(next).toMatchObject({ crop: '16:10', cx: 420, cy: 610, w: 700 });
    expect(windowTop({ ...prev, ...next, nh: 6000 })).toBeCloseTo(1550, 0);
  });

  it('shows the bottom when the page is now too short for the old position', () => {
    expect(reframe(captured(8000, 90), { nw: 1440, nh: 4000 }, 1500).fy).toBe(100);
  });

  it('keeps a window pinned to the bottom (a footer) at the bottom', () => {
    expect(reframe(captured(4000, 100), { nw: 1440, nh: 7000 }, 1500).fy).toBe(100);
  });

  it('compares positions in page widths, so 1× and 2× agree', () => {
    const prev = captured(8000, 32.26, { nw: 2880 }); // 2×: window top at ~1000 page px
    const next = reframe(prev, { nw: 1440, nh: 4000 }, 1500);
    expect(windowTop({ ...prev, ...next, nw: 1440, nh: 4000 })).toBeCloseTo(windowTop(prev), 0);
  });

  it('keeps the pan of a wide image', () => {
    const prev = captured(400, 0, { crop: '1:1', fx: 30 });
    expect(reframe(prev, { nw: 1440, nh: 500 }, 1500)).toMatchObject({ crop: '1:1', fx: 30, w: 700 });
  });

  it('keeps a Full crop on the canvas when the image gets taller', () => {
    const prev = captured(900, 0, { crop: 'full', w: 700 }); // 437.5 px tall
    expect(reframe(prev, { nw: 1440, nh: 900 }, 1500).w).toBe(700);
    const next = reframe(prev, { nw: 1440, nh: 9000 }, 1500); // would be 4375 px tall
    expect(next.w).toBe(Math.round(1350 * (1440 / 9000)));
  });
});

describe('where captures land', () => {
  const doc = (count: 1 | 2 | 3, kinds: ('sample' | 'file')[]): Composition => {
    const d = defaultComposition();
    d.count = count;
    kinds.forEach((k, i) => (d.slots[i].source = k === 'sample' ? { kind: 'sample' } : { kind: 'file' }));
    arrange(d);
    return d;
  };

  it('uses the drop-elsewhere rule, never on the layout to avoid', () => {
    expect(dropSlot(doc(2, ['sample', 'sample']))).toEqual({ i: 0, added: false });
    expect(dropSlot(doc(2, ['sample', 'sample']), 0)).toEqual({ i: 1, added: false });
    expect(dropSlot(doc(2, ['file', 'file']), 0)).toEqual({ i: 2, added: true });
    expect(dropSlot(doc(3, ['file', 'file', 'file']))).toEqual({ i: 0, added: false });
    expect(dropSlot(doc(3, ['file', 'file', 'file']), 0)).toEqual({ i: 1, added: false });
  });

  it('pairs the phone with the layout after the target', () => {
    expect(pairTarget({ count: 3 }, 0)).toBe(1);
    expect(pairTarget({ count: 2 }, 1)).toBeNull();
    expect(pairTarget({ count: 3 }, null)).toBeNull();
    const [desktop, phone] = pairOptions({ ...DEFAULT_CAPTURE, width: 834, fullPage: false, scale: 1, darkMode: true, hideSelectors: ['#chat'] });
    expect(desktop).toEqual({ ...DEFAULT_CAPTURE, width: 1440, fullPage: true, scale: 1, darkMode: true, hideSelectors: ['#chat'] });
    expect(phone).toEqual({ ...DEFAULT_CAPTURE, width: 390, fullPage: false, scale: 1, darkMode: true, hideSelectors: ['#chat'] });
  });

  it('lists the visible layouts that came from a URL', () => {
    const d = doc(2, ['file', 'sample']);
    d.slots[0].source = { kind: 'url', url: 'https://a.com', capturedAt: '', options: DEFAULT_CAPTURE, needsPassword: true };
    d.slots[2].source = { kind: 'url', url: 'https://hidden.com', capturedAt: '', options: DEFAULT_CAPTURE };
    expect(recapturable(d)).toEqual([{ i: 0, url: 'https://a.com', options: DEFAULT_CAPTURE, needsPassword: true }]);
  });
});

describe('autosave', () => {
  it('gives captures saved before dark mode and hide elements their defaults', () => {
    const d = defaultComposition();
    const old = clone(d) as unknown as { slots: Record<string, unknown>[] };
    old.slots[0].source = { kind: 'url', url: 'https://a.com', capturedAt: 'x', options: { width: 1440, fullPage: true, scale: 2, delayMs: 1500, hideBanners: true } };
    old.slots[1].source = { kind: 'url', url: 'https://b.com', capturedAt: 'x', options: { ...DEFAULT_CAPTURE, darkMode: 'yes', hideSelectors: ['#ok', 'x{'] } };
    const out = sanitizeComposition(old)!;
    expect(out.slots[0].source).toMatchObject({ options: { width: 1440, darkMode: false, hideSelectors: [] } });
    expect(out.slots[1].source).toMatchObject({ options: { darkMode: false, hideSelectors: ['#ok'] } });
    expect(out.slots[2].source).toEqual({ kind: 'sample' });
  });
});
