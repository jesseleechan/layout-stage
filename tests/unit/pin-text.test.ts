/* Pin text (lib/pin-text.ts): suggestions from what the canvas knows, Pinterest's limits, edited
   fields over suggestions, and older saves without pin text. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { clone, DEFAULT_CAPTURE, type Composition, type Slot } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import {
  copyAllText, firstCaptureUrl, joinNames, PIN_LIMITS, pinTextOf, sanitizePinText, siteName, siteNames, suggestPinText, trimTo,
} from '@/lib/pin-text';

const url = (u: string, width: 1440 | 390 = 1440): Slot['source'] => ({ kind: 'url', url: u, capturedAt: '2026-01-01T00:00:00Z', options: { ...DEFAULT_CAPTURE, width } });
const file = (name: string): Pick<Slot, 'name' | 'source'> => ({ name, source: { kind: 'file' } });

function doc(patch: (d: Composition) => void = () => {}): Composition {
  const d = defaultComposition();
  patch(d);
  return d;
}

describe('site names', () => {
  it('from captures, samples and file names that read like one', () => {
    expect(siteName({ name: 'juniper.co/shop', source: url('https://www.juniper.co/shop?a=1') })).toBe('juniper.co');
    expect(siteName({ name: 'Northbeam', source: { kind: 'sample' } })).toBe('Northbeam');
    expect(siteName(file('maple-and-moss_home.png'))).toBe('maple and moss home');
    for (const n of ['Screenshot 2026-05-01 at 10.22.33.png', 'Screen Shot 2024-01-01.png', 'CleanShot 2026.png', 'IMG_2041.jpg', 'Pasted image', 'image.png', '20260501.png', 'x.png']) {
      expect(siteName(file(n))).toBeNull();
    }
  });

  it('distinct names of the visible layouts, in order', () => {
    const d = doc((d) => { d.count = 3; d.slots[2].name = 'Northbeam'; });
    expect(siteNames(d)).toEqual(['Juniper & Co.', 'Northbeam']);
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('the destination link is the first captured URL, else empty', () => {
    expect(firstCaptureUrl(doc())).toBe('');
    const d = doc((d) => { d.slots[1].source = url('https://northbeam.studio/'); d.slots[2].source = url('https://hidden.example/'); });
    expect(firstCaptureUrl(d)).toBe('https://northbeam.studio/');
  });
});

describe('suggestions', () => {
  it('a Pinterest pin of two sample sites', () => {
    expect(suggestPinText(doc())).toEqual({
      title: 'Juniper & Co. and Northbeam — website designs',
      description: '2 website designs: Juniper & Co. and Northbeam. Save this pin for your next web design project.',
      alt: 'Pinterest pin showing screenshots of 2 websites (Juniper & Co. and Northbeam) in frames on a soft color background.',
      link: '',
    });
  });

  it('one captured site on desktop and phone, with its link', () => {
    const d = doc((d) => {
      d.slots[0].source = url('https://www.juniper.co/');
      d.slots[1].source = url('https://www.juniper.co/', 390);
    });
    const s = suggestPinText(d);
    expect(s.title).toBe('juniper.co — website design on desktop and mobile');
    expect(s.description).toBe('The juniper.co website design on desktop and mobile. See it live at juniper.co. Save this pin for your next web design project.');
    expect(s.alt).toBe('Pinterest pin showing screenshots of the juniper.co website on desktop and mobile in frames on a soft color background.');
    expect(s.link).toBe('https://www.juniper.co/');
  });

  it('an Etsy listing talks about templates and the listing', () => {
    const d = doc((d) => { d.preset = 'etsy43'; d.count = 1; d.background.type = 'solid'; });
    const s = suggestPinText(d);
    expect(s.title).toBe('Juniper & Co. website template');
    expect(s.description).toBe('The Juniper & Co. website template. See the full listing on Etsy for every page and what’s included.');
    expect(s.alt).toBe('Etsy listing photo showing a screenshot of the Juniper & Co. website in a frame on a plain background.');
  });

  it('the headline becomes the title; headline and badge are in the alt text', () => {
    const d = doc((d) => {
      d.overlays!.headline.enabled = true;
      d.overlays!.headline.text = 'A calm Shopify theme\nfor small brands';
      d.overlays!.badge.enabled = true;
      d.overlays!.badge.text = '$29';
    });
    const s = suggestPinText(d);
    expect(s.title).toBe('A calm Shopify theme for small brands');
    expect(s.description.startsWith('A calm Shopify theme for small brands. 2 website designs')).toBe(true);
    expect(s.alt).toContain('with the headline “A calm Shopify theme for small brands” and a “$29” badge.');
  });

  it('without names it still reads well', () => {
    const d = doc((d) => {
      d.slots[0] = { ...d.slots[0], ...file('Screenshot 1.png') };
      d.slots[1] = { ...d.slots[1], ...file('IMG_1.png') };
    });
    const s = suggestPinText(d);
    expect(s.title).toBe('2 website designs');
    expect(s.description).toBe('2 website designs. Save this pin for your next web design project.');
    expect(s.alt).toBe('Pinterest pin showing 2 website screenshots in frames on a soft color background.');
  });

  it('stays within Pinterest’s limits, cut at a word', () => {
    const long = 'Wonderful Studio '.repeat(4).trim();
    const d = doc((d) => {
      d.count = 3;
      d.slots.forEach((s, i) => { s.name = `${long} ${i}`; });
      d.overlays!.badge.enabled = true;
      d.overlays!.badge.text = 'B'.repeat(24);
    });
    const s = suggestPinText(d);
    expect(s.title.length).toBeLessThanOrEqual(PIN_LIMITS.title);
    expect(s.title.endsWith('…')).toBe(true);
    expect(s.description.length).toBeLessThanOrEqual(PIN_LIMITS.description);
    expect(s.alt.length).toBeLessThanOrEqual(PIN_LIMITS.alt);
    expect(trimTo('one two three four', 16)).toBe('one two three…');
    expect(trimTo('short', 12)).toBe('short');
    expect(trimTo('a, b, c, d, e', 6)).toBe('a, b…');
  });
});

describe('edited text', () => {
  it('edited fields win; the rest follow the suggestion', () => {
    const d = doc((d) => { d.pin = { title: 'My title', link: '' }; });
    const { values, suggested, edited } = pinTextOf(d);
    expect(values.title).toBe('My title');
    expect(values.link).toBe('');
    expect(values.description).toBe(suggested.description);
    expect(edited).toEqual({ title: true, description: false, alt: false, link: true });
  });

  it('copy all labels each field and skips empty ones', () => {
    expect(copyAllText({ title: 'T', description: 'D', alt: 'A', link: '' })).toBe('Title: T\n\nDescription: D\n\nAlt text: A');
  });

  it('older saves have no pin text; bad values are dropped and long ones cut', () => {
    const old = clone(defaultComposition()) as Partial<Composition>;
    delete old.pin;
    const out = sanitizeComposition(old)!;
    expect('pin' in out).toBe(false);
    expect(sanitizePinText(undefined)).toBeUndefined();
    expect(sanitizePinText({ title: 5, other: 'x' })).toBeUndefined();
    expect(sanitizePinText({ title: 'x'.repeat(150), alt: '' })).toEqual({ title: 'x'.repeat(100), alt: '' });
    const saved = sanitizeComposition({ ...clone(defaultComposition()), pin: { description: 'Mine' } })!;
    expect(saved.pin).toEqual({ description: 'Mine' });
  });
});
