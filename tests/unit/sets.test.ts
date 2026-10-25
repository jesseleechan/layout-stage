/* Derived compositions: Export all sizes and the Etsy listing set. */
import { describe, expect, it } from 'vitest';
import { arrange, defaultComposition } from '@/lib/arrange';
import { clone, DEFAULT_CAPTURE, PRESETS, type Composition, type Slot } from '@/lib/model';
import { cropRatio, groupBounds, rectOf } from '@/lib/render/units';
import {
  allSizes, closeUp, desktopAndPhone, etsySet, forPreset, isPhone, isWide, mainSlot, sectionStops, setFileName,
} from '@/lib/sets';

/** A phone screenshot upload (auto-crop gives Full). */
const phoneShot = (patch: Partial<Slot> = {}): Slot => ({
  imageId: 'img_phone', name: 'phone.png', source: { kind: 'file' }, nw: 1170, nh: 2532, crop: 'full', fx: 50, fy: 0, cx: 500, cy: 750, w: 300, ...patch,
});

/** The default pin, with three layouts and a scrolled, re-cropped slot 1. */
function threeUp(): Composition {
  const d = defaultComposition();
  d.count = 3;
  arrange(d);
  d.slots[1].fy = 40;
  d.slots[2].crop = '4:5';
  return d;
}

const inside = (d: Composition) => {
  for (let i = 0; i < d.count; i++) {
    const r = rectOf(d.slots[i]);
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.t).toBeGreaterThanOrEqual(0);
    expect(r.l + r.w).toBeLessThanOrEqual(d.W);
    expect(r.t + r.h).toBeLessThanOrEqual(d.H);
  }
};

describe('forPreset', () => {
  it('moves the composition to another canvas, re-arranged, keeping everything else', () => {
    const src = threeUp();
    const d = forPreset(src, 'etsy43');
    expect([d.preset, d.W, d.H]).toEqual(['etsy43', 3000, 2250]);
    const ref = clone(src);
    Object.assign(ref, { preset: 'etsy43', W: 3000, H: 2250 });
    arrange(ref);
    d.slots.forEach((s, i) => {
      expect({ cx: s.cx, cy: s.cy, w: s.w }).toEqual({ cx: ref.slots[i].cx, cy: ref.slots[i].cy, w: ref.slots[i].w });
      expect({ imageId: s.imageId, crop: s.crop, fx: s.fx, fy: s.fy }).toEqual({
        imageId: src.slots[i].imageId, crop: src.slots[i].crop, fx: src.slots[i].fx, fy: src.slots[i].fy,
      });
    });
    expect(d.frame).toEqual(src.frame);
    expect(d.background).toEqual(src.background);
    expect(d.count).toBe(3);
    // The source is untouched.
    expect(src.preset).toBe('pin');
  });

  it('an untouched layer order follows the new shape; a changed one is kept', () => {
    const src = threeUp();
    expect(forPreset(src, 'etsy43').order).toEqual([1, 2, 0]); // landscape 3-up: hero in front
    expect(forPreset(src, 'etsy11').order).toEqual([1, 2, 0]);
    src.order = [2, 0, 1];
    expect(forPreset(src, 'etsy43').order).toEqual([2, 0, 1]);
    expect(forPreset(src, 'etsy11').order).toEqual([2, 0, 1]);
  });

  it('keeps the composition exactly as it is on its own canvas', () => {
    const src = threeUp();
    src.slots[0].cx += 33;
    expect(forPreset(src, 'pin')).toEqual(src);
  });
});

describe('allSizes', () => {
  it('gives a pin, Etsy 4:3 and Etsy square, each at its default export scale', () => {
    const items = allSizes(defaultComposition());
    expect(items.map((i) => [i.key, i.doc.W, i.doc.H, i.scale])).toEqual([
      ['pin', 1000, 1500, 2],
      ['etsy43', 3000, 2250, 1],
      ['etsy11', 2000, 2000, 1],
    ]);
    expect(items.map((i) => i.label)).toEqual([PRESETS.pin.label, PRESETS.etsy43.label, PRESETS.etsy11.label]);
    items.forEach((i) => inside(i.doc));
  });
});

describe('layout shapes', () => {
  it('tells phones from desktop pages', () => {
    const d = defaultComposition();
    expect(isWide(d.slots[0])).toBe(true); // a sample at 16:10
    expect(isPhone(d.slots[0])).toBe(false);
    expect(isPhone(phoneShot())).toBe(true);
    expect(isPhone(phoneShot({ crop: '9:16' }))).toBe(true);
    expect(isWide(phoneShot())).toBe(false);
    // A full-height desktop page is neither: tall, but not a phone.
    expect(isPhone({ ...d.slots[0], crop: '4:5' })).toBe(false);
    expect(isWide({ ...d.slots[0], crop: '4:5' })).toBe(false);
    // Captures say what device they were taken at.
    const url = (width: 1440 | 390) => ({ kind: 'url' as const, url: 'https://x.test', capturedAt: '', options: { ...DEFAULT_CAPTURE, width } });
    expect(isPhone(phoneShot({ source: url(390), crop: '16:10' }))).toBe(true);
    expect(isWide(phoneShot({ source: url(390), crop: '16:10' }))).toBe(false);
    expect(isPhone({ ...d.slots[0], source: url(1440), crop: 'full' })).toBe(false);
  });

  it('the main layout is the first one that is not a phone', () => {
    const d = defaultComposition();
    expect(mainSlot(d)).toBe(0);
    d.slots[0] = phoneShot();
    expect(mainSlot(d)).toBe(1);
    d.slots[1] = phoneShot();
    expect(mainSlot(d)).toBe(0);
  });
});

describe('sectionStops', () => {
  const sample = defaultComposition().slots[0]; // 1440 × 2560 at 16:10: the page is 2.8 windows tall

  it('three stops spread down a long page', () => {
    expect(sectionStops(sample)).toEqual([0, 50, 100]);
    expect(sectionStops({ ...sample, nh: 12000 })).toEqual([0, 50, 100]);
  });

  it('fewer when the page has fewer distinct sections', () => {
    expect(sectionStops({ ...sample, nh: 1500 })).toEqual([0, 100]); // 1.7 windows
    expect(sectionStops({ ...sample, nh: 1000, fy: 30 })).toEqual([30]); // 1.1 windows: one, where it is now
  });

  it('none when the crop shows the whole image', () => {
    expect(sectionStops({ ...sample, crop: 'full' })).toEqual([]);
    expect(sectionStops({ ...sample, nw: 1600, nh: 1000 })).toEqual([]);
  });

  it('pans across a wide image', () => {
    expect(sectionStops({ ...sample, nw: 2880, nh: 1000, crop: '1:1' })).toEqual([0, 50, 100]);
  });
});

describe('closeUp and desktopAndPhone', () => {
  it('a close-up shows one layout large, centered, at the stop', () => {
    const src = threeUp();
    const d = closeUp(src, 1, 100);
    expect([d.preset, d.W, d.H, d.count]).toEqual(['etsy43', 3000, 2250, 1]);
    expect(d.slots[0].imageId).toBe(src.slots[1].imageId);
    expect(d.slots[0].fy).toBe(100);
    expect([d.slots[0].cx, d.slots[0].cy]).toEqual([1500, 1125]);
    const r = rectOf(d.slots[0]);
    expect(r.w).toBeGreaterThan(d.W * 0.8);
    inside(d);
    expect(d.frame).toEqual(src.frame);
    expect(d.background).toEqual(src.background);
  });

  it('desktop + phone: phone in front, overlapping the desktop, the pair centered', () => {
    const src = defaultComposition();
    src.slots[1] = phoneShot();
    const d = desktopAndPhone(src, 0, 1);
    expect(d.count).toBe(2);
    expect(d.order.filter((i) => i < 2)).toEqual([0, 1]);
    expect(d.slots[1].imageId).toBe('img_phone');
    const D = rectOf(d.slots[0]), P = rectOf(d.slots[1]);
    expect(P.l).toBeLessThan(D.l + D.w);
    expect(P.l + P.w).toBeGreaterThan(D.l + D.w);
    expect(P.h).toBeGreaterThan(D.h);
    const g = groupBounds(d);
    expect(Math.abs(g.l + g.w / 2 - d.W / 2)).toBeLessThan(2);
    expect(Math.abs(g.t + g.h / 2 - d.H / 2)).toBeLessThan(2);
    inside(d);
    expect(cropRatio(d.slots[1])).toBeCloseTo(1170 / 2532);
  });
});

describe('etsySet', () => {
  it('hero, three sections and a palette for the default canvas', () => {
    const items = etsySet(defaultComposition());
    expect(items.map((i) => i.key)).toEqual(['hero', 'top', 'middle', 'bottom', 'palette']);
    expect(items.map((i) => i.label)).toEqual(['Hero', 'Top section', 'Middle section', 'Bottom section', 'Palette']);
    items.forEach((i) => expect([i.doc.preset, i.doc.W, i.doc.H]).toEqual(['etsy43', 3000, 2250]));
    expect(items.slice(1, 4).map((i) => i.doc.slots[0].fy)).toEqual([0, 50, 100]);
    const pal = items[4];
    expect(pal.kind).toBe('palette');
    if (pal.kind === 'palette') expect(pal.doc.slots[pal.slot].imageId).toBe('sample:juniper');
    items.forEach((i) => inside(i.doc));
  });

  it('adds desktop + phone when the canvas has both', () => {
    const d = defaultComposition();
    d.slots[1] = phoneShot();
    const items = etsySet(d);
    expect(items.map((i) => i.key)).toEqual(['hero', 'top', 'middle', 'bottom', 'desktop-phone', 'palette']);
    expect(items[4].doc.slots.slice(0, 2).map((s) => s.imageId)).toEqual(['sample:juniper', 'img_phone']);
  });

  it('skips sections when the main layout shows the whole image', () => {
    const d = defaultComposition();
    Object.assign(d.slots[0], { nw: 2880, nh: 1800, crop: 'full' }); // a first-screen capture
    expect(etsySet(d).map((i) => i.key)).toEqual(['hero', 'palette']);
    // A tall page shown Full is phone-shaped, so the next layout becomes the main one.
    const e = defaultComposition();
    e.slots[0].crop = 'full';
    expect(mainSlot(e)).toBe(1);
  });

  it('uses only visible layouts', () => {
    const d = defaultComposition();
    d.count = 1;
    d.slots[1] = phoneShot();
    expect(etsySet(d).map((i) => i.key)).not.toContain('desktop-phone');
  });

  it('never goes past Etsy’s 10 photos', () => {
    expect(etsySet(threeUp()).length).toBeLessThanOrEqual(10);
  });

  it('numbers file names in listing order', () => {
    expect(setFileName(0, 'hero', 3000, 2250, 'png')).toBe('01-layout-stage-etsy-hero-3000x2250.png');
    expect(setFileName(9, 'palette', 3000, 2250, 'jpg')).toBe('10-layout-stage-etsy-palette-3000x2250.jpg');
  });
});
