/* Crops and free height (lib/crop.ts): the taller presets, the height range, snapping to Full or a
   preset, keeping the top edge and the part of the page in view, and the free height surviving a
   save, a re-capture, a width change and the store's undo. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { reframe } from '@/lib/capture/recapture';
import { cropFor, heightRange, MAX_AR, setCropOf, setHeight, TALLEST_AR } from '@/lib/crop';
import { CROPS, defaultUi, type Slot } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { coverSource, cropRatio, rectOf, scrollAxis } from '@/lib/render/units';
import { snapBottom } from '@/lib/snap';
import { useEditor } from '@/lib/store';

/** A 1440 × 9000 page, 400 wide at 4:5, scrolled 30% down. */
const page = (patch: Partial<Slot> = {}): Slot => ({
  imageId: 'img_page', name: 'page.png', source: { kind: 'file' }, nw: 1440, nh: 9000,
  crop: '4:5', fx: 50, fy: 30, cx: 500, cy: 600, w: 400, ...patch,
});
const windowTop = (s: Slot) => coverSource(s.nw, s.nh, s.w, rectOf(s).h, s.fx, s.fy).sy;

describe('crops', () => {
  it('has two rows of four, the tallest 1:2', () => {
    expect(CROPS.map((c) => c.id)).toEqual(['full', '16:10', '4:3', '1:1', '4:5', '2:3', '9:16', '1:2']);
    expect(cropRatio(page({ crop: '2:3' }))).toBeCloseTo(2 / 3, 9);
    expect(cropRatio(page({ crop: '1:2' }))).toBe(TALLEST_AR);
  });

  it('a free height reads its own ratio, and the whole page without one', () => {
    expect(cropRatio(page({ crop: 'custom', ar: 0.37 }))).toBe(0.37);
    expect(cropRatio(page({ crop: 'custom' }))).toBe(1440 / 9000);
    expect(cropRatio(page({ crop: '4:5', ar: 0.37 }))).toBe(0.8); // a leftover ratio is ignored
  });

  it('setting a preset drops the free height’s ratio', () => {
    const s = page({ crop: 'custom', ar: 0.4 });
    setCropOf(s, '1:1');
    expect('ar' in s).toBe(false);
  });
});

describe('heightRange', () => {
  it('a long page: from a 3:1 band to the whole page', () => {
    const r = heightRange(page());
    expect(r.min).toBeCloseTo(400 / MAX_AR, 9);
    expect(r.max).toBeCloseTo(2500, 9); // 400 × 9000 / 1440
  });

  it('a short or wide image still reaches 1:2', () => {
    expect(heightRange(page({ nw: 1440, nh: 900 })).max).toBe(800);
  });
});

describe('cropFor', () => {
  it('snaps within 1% to Full or a preset, else a free ratio', () => {
    expect(cropFor(page(), 0.502)).toEqual({ crop: '1:2' });
    expect(cropFor(page(), 0.16)).toEqual({ crop: 'full' });
    expect(cropFor(page(), 0.42)).toEqual({ crop: 'custom', ar: 0.42 });
  });
});

describe('setHeight', () => {
  it('keeps the width, the top edge and the part of the page at the top of the window', () => {
    const s = page();
    const { t } = rectOf(s);
    const sy = windowTop(s);
    setHeight(s, 950);
    expect([s.crop, s.w]).toEqual(['custom', 400]);
    expect(rectOf(s).h).toBeCloseTo(950, 6);
    expect(rectOf(s).t).toBeCloseTo(t, 6);
    expect(windowTop(s)).toBeCloseTo(sy, 0);
  });

  it('clamps to the range and becomes Full at the whole page', () => {
    const s = page();
    setHeight(s, 99999);
    expect(s.crop).toBe('full');
    expect(scrollAxis(s)).toBeNull();
    setHeight(s, 1);
    expect(rectOf(s).h).toBeCloseTo(400 / MAX_AR, 6);
  });

  it('a page that can’t fill the taller window shows its bottom', () => {
    const s = page({ fy: 100 });
    setHeight(s, 1500);
    expect(s.fy).toBe(100);
  });

  it('near a preset it takes the preset, unless told not to', () => {
    const s = page();
    setHeight(s, 801);
    expect(s.crop).toBe('1:2');
    setHeight(s, 801, false);
    expect(s.crop).toBe('custom');
  });

  it('a width change keeps the free height’s shape', () => {
    const s = page();
    setHeight(s, 1000);
    s.w = 200;
    expect(rectOf(s).h).toBeCloseTo(500, 6);
  });
});

describe('the free height elsewhere', () => {
  it('is kept by a save; a broken one shows the whole page; others drop it', () => {
    const d = defaultComposition();
    Object.assign(d.slots[0], { crop: 'custom', ar: 0.42 });
    Object.assign(d.slots[1], { crop: 'custom', ar: 'x' });
    Object.assign(d.slots[2], { crop: '4:5', ar: 0.3 });
    const out = sanitizeComposition(d)!;
    expect([out.slots[0].crop, out.slots[0].ar]).toEqual(['custom', 0.42]);
    expect(out.slots[1].crop).toBe('full');
    expect('ar' in out.slots[1] || 'ar' in out.slots[2]).toBe(false);
  });

  it('is kept by a re-capture', () => {
    const f = reframe(page({ crop: 'custom', ar: 0.42 }), { nw: 1440, nh: 12000 }, 1500);
    expect([f.crop, f.ar]).toEqual(['custom', 0.42]);
    expect('ar' in reframe(page(), { nw: 1440, nh: 12000 }, 1500)).toBe(false);
  });
});

describe('snapBottom', () => {
  it('snaps to the canvas bottom and center, the other layouts and the safe area', () => {
    const d = defaultComposition();
    expect(snapBottom(d, 0, 1496, 8)).toEqual({ y: 1500, gy: 1500 });
    expect(snapBottom(d, 0, 744, 8)).toEqual({ y: 750, gy: 750 });
    const r = rectOf(d.slots[1]);
    expect(snapBottom(d, 0, r.t + 3, 8)).toEqual({ y: r.t, gy: r.t });
    expect(snapBottom(d, 0, 1300, 8, true, { l: 100, t: 150, w: 800, h: 1152 })).toEqual({ y: 1302, gy: 1302 });
    expect(snapBottom(d, 0, 1496, 8, false)).toEqual({ y: 1496, gy: null });
  });
});

describe('store.setHeight', () => {
  it('is live, then one undo step on commit', () => {
    const S = () => useEditor.getState();
    S().loadComposition(defaultComposition());
    useEditor.setState({ ui: { ...defaultUi(), selected: 0 }, toast: null });
    const before = S().doc.slots[0];
    // A 1440 × 2560 sample, 375 wide: up to 1:2, 750 tall.
    S().setHeight(0, 680);
    S().setHeight(0, 700);
    expect(S().canUndo).toBe(false);
    S().commit();
    expect(S().doc.slots[0].crop).toBe('custom');
    expect(rectOf(S().doc.slots[0]).h).toBeCloseTo(700, 6);
    S().setHeight(0, 2000);
    expect([S().doc.slots[0].crop, rectOf(S().doc.slots[0]).h]).toEqual(['1:2', 750]);
    S().commit();
    S().undo();
    S().setCrop(0, '4:5');
    expect('ar' in S().doc.slots[0]).toBe(false);
    S().undo();
    S().undo();
    expect(S().doc.slots[0]).toEqual(before);
  });
});
