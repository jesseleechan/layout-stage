/* Switching canvas sizes keeps the work (lib/canvas-size.ts): each size remembers its placement, a
   fresh arrangement is re-arranged for the new shape, a moved one is scaled as one piece. */
import { describe, expect, it } from 'vitest';
import { arrange, defaultComposition } from '@/lib/arrange';
import {
  fit, isArranged, MAX_REMEMBERED, recall, remember, resizeCanvas, sanitizePlacements, sizeKey, snapshot,
} from '@/lib/canvas-size';
import { clone, type Composition } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { rectOf } from '@/lib/render/units';
import { classicComposition } from './helpers';

const spots = (d: Composition) => d.slots.slice(0, d.count).map((s) => [s.cx, s.cy, s.w]);

/** A showcase pin of long pages (1440 × 7680 shown whole). */
function longPages(n: 1 | 2 | 3 = 2): Composition {
  const d = defaultComposition();
  d.count = n;
  d.slots.forEach((s, i) => Object.assign(s, { imageId: `p${i}`, nh: 7680, crop: 'full' }));
  arrange(d);
  return d;
}

/** The pin with layout 1 dragged off its starting spot. */
function moved(d = classicComposition()): Composition {
  d.slots[0].cx += 37;
  d.slots[0].cy -= 51;
  return d;
}

describe('isArranged', () => {
  it('is true where arrange() puts the layouts, false once one moves or the layer order changes', () => {
    const d = classicComposition();
    expect(isArranged(d)).toBe(true);
    expect(isArranged(moved(clone(d)))).toBe(false);
    const o = clone(d);
    o.order = [1, 0, 2];
    expect(isArranged(o)).toBe(false);
    // Hidden layouts don't count.
    const h = clone(d);
    h.slots[2].cx = -500;
    expect(isArranged(h)).toBe(true);
  });
});

describe('resizeCanvas', () => {
  it('re-arranges layouts that are where arrange() put them', () => {
    const d = classicComposition();
    expect(resizeCanvas(d, 3000, 2250, null, 'etsy43')).toBe('arranged');
    const want = clone(d);
    arrange(want);
    expect(spots(d)).toEqual(spots(want));
    expect([d.preset, d.W, d.H]).toEqual(['etsy43', 3000, 2250]);
  });

  it('keeps moved layouts: the arrangement scaled as one piece, still on the canvas', () => {
    const d = moved();
    const before = clone(d);
    expect(resizeCanvas(d, 3000, 2250, null, 'etsy43')).toBe('fitted');
    // Scaled by the smaller ratio (2250 / 1500): same proportions, same overlaps.
    const k = 1.5;
    expect(d.slots[0].w).toBeCloseTo(before.slots[0].w * k, 6);
    expect(d.slots[1].cx - d.slots[0].cx).toBeCloseTo((before.slots[1].cx - before.slots[0].cx) * k, 6);
    expect(d.slots[1].cy - d.slots[0].cy).toBeCloseTo((before.slots[1].cy - before.slots[0].cy) * k, 6);
    expect(d.order).toEqual(before.order);
    for (let i = 0; i < d.count; i++) {
      const r = rectOf(d.slots[i]);
      expect(r.l).toBeGreaterThanOrEqual(0);
      expect(r.l + r.w).toBeLessThanOrEqual(3000);
      expect(r.t).toBeGreaterThanOrEqual(0);
      expect(r.t + r.h).toBeLessThanOrEqual(2250);
    }
  });

  it('restores each size exactly when you come back, however often you switch', () => {
    const d = moved();
    const pin = spots(d);
    resizeCanvas(d, 3000, 2250, null, 'etsy43');
    d.slots[1].cx += 120; // adjusted on the Etsy canvas
    const etsy = spots(d);
    expect(resizeCanvas(d, 1000, 1500, null, 'pin')).toBe('restored');
    expect(spots(d)).toEqual(pin);
    expect(resizeCanvas(d, 3000, 2250, null, 'etsy43')).toBe('restored');
    expect(spots(d)).toEqual(etsy);
    expect(resizeCanvas(d, 1000, 1500, null, 'pin')).toBe('restored');
    expect(spots(d)).toEqual(pin);
  });

  it('restores the layer order too', () => {
    const d = classicComposition();
    d.count = 3;
    arrange(d);
    d.order = [2, 0, 1];
    resizeCanvas(d, 2000, 2000);
    d.order = [0, 1, 2];
    resizeCanvas(d, 1000, 1500);
    expect(d.order).toEqual([2, 0, 1]);
  });

  it('doesn’t restore a placement for another number of layouts or another arrangement', () => {
    const d = moved();
    resizeCanvas(d, 2000, 2000);
    d.count = 3;
    arrange(d);
    expect(recall(d, 1000, 1500)).toBeNull();
    d.count = 2;
    expect(recall(d, 1000, 1500)).not.toBeNull();
    d.arrangement = 'showcase';
    expect(recall(d, 1000, 1500)).toBeNull();
  });

  it('the same size changes only the preset', () => {
    const d = moved();
    const before = spots(d);
    expect(resizeCanvas(d, 1000, 1500, null, 'custom')).toBe('same');
    expect(spots(d)).toEqual(before);
    expect(d.preset).toBe('custom');
    expect(d.placements).toBeUndefined();
  });

  it('remembers at most MAX_REMEMBERED sizes, the most recently left kept', () => {
    const d = moved();
    for (let i = 0; i < MAX_REMEMBERED + 3; i++) resizeCanvas(d, 1000 + i * 10, 1500);
    const keys = Object.keys(d.placements!);
    expect(keys).toHaveLength(MAX_REMEMBERED);
    expect(keys.at(-1)).toBe(sizeKey(1000 + (MAX_REMEMBERED + 1) * 10, 1500));
    expect(keys).not.toContain(sizeKey(1000, 1500));
  });
});

describe('fit', () => {
  it('a page running off the bottom keeps its top margin (as a share of the height) and runs off still', () => {
    const d = longPages(1);
    d.slots[0].cx += 10; // moved, so resizeCanvas would fit
    const t0 = rectOf(d.slots[0]).t;
    fit(d, 3000, 2250);
    expect(rectOf(d.slots[0]).t).toBeCloseTo((t0 / 1500) * 2250, 6);
    // Etsy 4:3 → pin scales by 1/3: the top margin keeps its share, the page still runs off.
    const e = clone(d);
    e.W = 3000;
    e.H = 2250;
    const te = rectOf(e.slots[0]).t;
    fit(e, 1000, 1500);
    const r = rectOf(e.slots[0]);
    expect(r.t).toBeCloseTo((te / 2250) * 1500, 6);
    expect(r.t + r.h).toBeGreaterThan(1500);
  });

  it('a page running off the top keeps its bottom margin', () => {
    const d = classicComposition();
    d.count = 1;
    Object.assign(d.slots[0], { crop: 'full', nh: 7680, w: 400, cx: 500 });
    d.slots[0].cy = 1300 - rectOf(d.slots[0]).h / 2; // bottom edge at 1300, top far above
    fit(d, 2000, 2000);
    const r = rectOf(d.slots[0]);
    expect(r.t + r.h).toBeCloseTo((1300 / 1500) * 2000, 6);
  });

  it('a group on the canvas keeps the place of its middle', () => {
    const d = moved();
    const b = { l: Infinity, r: -Infinity };
    for (let i = 0; i < d.count; i++) { const q = rectOf(d.slots[i]); b.l = Math.min(b.l, q.l); b.r = Math.max(b.r, q.l + q.w); }
    const mid = (b.l + b.r) / 2;
    fit(d, 3000, 2250);
    const a = { l: Infinity, r: -Infinity };
    for (let i = 0; i < d.count; i++) { const q = rectOf(d.slots[i]); a.l = Math.min(a.l, q.l); a.r = Math.max(a.r, q.l + q.w); }
    expect((a.l + a.r) / 2).toBeCloseTo((mid / 1000) * 3000, 6);
  });
});

describe('placements in storage', () => {
  it('snapshot / remember store positions and order under the size', () => {
    const d = moved();
    remember(d);
    expect(d.placements![sizeKey(1000, 1500)]).toEqual(snapshot(d));
    expect(snapshot(d)).toMatchObject({ count: 2, arrangement: 'classic', order: d.order });
  });

  it('a canvas saved before arrangements reads back as classic; placements survive a save', () => {
    const old = clone(classicComposition()) as Partial<Composition>;
    delete old.arrangement;
    expect(sanitizeComposition(old)!.arrangement).toBe('classic');
    expect(sanitizeComposition(defaultComposition())!.arrangement).toBe('showcase');
    const d = moved();
    resizeCanvas(d, 2000, 2000);
    expect(sanitizeComposition(JSON.parse(JSON.stringify(d)))!.placements).toEqual(d.placements);
    expect('placements' in sanitizeComposition({ ...d, placements: { x: 1 } } as unknown as Composition)!).toBe(false);
  });

  it('sanitizePlacements keeps only well-formed entries', () => {
    const d = moved();
    remember(d);
    const good = d.placements![sizeKey(1000, 1500)];
    expect(sanitizePlacements(null)).toBeUndefined();
    expect(sanitizePlacements({})).toBeUndefined();
    expect(sanitizePlacements({ '1000x1500': good })).toEqual({ '1000x1500': good });
    expect(sanitizePlacements({
      '1000x1500': good,
      bogus: good,
      '200x200': { ...good, count: 4 },
      '300x300': { ...good, slots: good.slots.slice(0, 2) },
      '400x400': { ...good, slots: [{ cx: 1, cy: 1, w: 0 }, good.slots[1], good.slots[2]] },
      '500x500': { ...good, order: [0, 0, 1] },
      '600x600': { ...good, arrangement: 'other' },
    })).toEqual({ '1000x1500': good });
  });
});
