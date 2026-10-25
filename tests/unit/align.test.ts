import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import type { Composition } from '@/lib/model';
import { alignLayouts, canAlign, canDistribute, distributeLayouts } from '@/lib/align';
import { rectOf } from '@/lib/render/units';

/** Three layouts of different sizes on a 1000 × 1500 canvas.
 *  0: 1:1, 200 × 200 at (300, 400) → x 200–400, y 300–500
 *  1: 16:10, 160 × 100 at (800, 250) → x 720–880, y 200–300
 *  2: 1:1, 100 × 100 at (450, 1100) → x 400–500, y 1050–1150 */
function fixture(count: 1 | 2 | 3 = 3): Composition {
  const d = defaultComposition();
  d.count = count;
  d.slots[0] = { ...d.slots[0], crop: '1:1', w: 200, cx: 300, cy: 400 };
  d.slots[1] = { ...d.slots[1], crop: '16:10', w: 160, cx: 800, cy: 250 };
  d.slots[2] = { ...d.slots[2], crop: '1:1', w: 100, cx: 450, cy: 1100 };
  return d;
}
const rects = (d: Composition) => d.slots.slice(0, d.count).map((s) => rectOf(s));

describe('alignLayouts', () => {
  it('moves the others so their edge lines up with the reference, which stays put', () => {
    const cases: [Parameters<typeof alignLayouts>[2], (r: ReturnType<typeof rectOf>) => number, number][] = [
      ['left', (r) => r.l, 200],
      ['center', (r) => r.l + r.w / 2, 300],
      ['right', (r) => r.l + r.w, 400],
      ['top', (r) => r.t, 300],
      ['middle', (r) => r.t + r.h / 2, 400],
      ['bottom', (r) => r.t + r.h, 500],
    ];
    for (const [edge, read, want] of cases) {
      const d = fixture();
      const before = rects(d);
      expect(alignLayouts(d, 0, edge)).toBe(true);
      const after = rects(d);
      expect(after[0]).toEqual(before[0]);
      for (const r of after) expect(read(r)).toBeCloseTo(want, 9);
      // Only the aligned axis moves; sizes never change.
      const horizontal = edge === 'left' || edge === 'center' || edge === 'right';
      after.forEach((r, j) => {
        expect(horizontal ? r.t : r.l).toBeCloseTo(horizontal ? before[j].t : before[j].l, 9);
        expect([r.w, r.h]).toEqual([before[j].w, before[j].h]);
      });
    }
  });

  it('uses the given reference', () => {
    const d = fixture();
    alignLayouts(d, 1, 'right');
    expect(rects(d).map((r) => r.l + r.w)).toEqual([880, 880, 880]);
    expect(d.slots[1].cx).toBe(800);
  });

  it('reports no change when already aligned, so a second click is a no-op', () => {
    const d = fixture();
    expect(alignLayouts(d, 2, 'bottom')).toBe(true);
    const once = JSON.stringify(d);
    expect(alignLayouts(d, 2, 'bottom')).toBe(false);
    expect(JSON.stringify(d)).toBe(once);
  });

  it('ignores hidden layouts and needs 2 visible', () => {
    const d = fixture(2);
    alignLayouts(d, 0, 'left');
    expect(d.slots[2].cx).toBe(450);
    expect(canAlign(fixture(1))).toBe(false);
    expect(canAlign(fixture(2))).toBe(true);
    const one = fixture(1);
    expect(alignLayouts(one, 0, 'left')).toBe(false);
    expect(alignLayouts(fixture(2), 2, 'left')).toBe(false); // reference not visible
  });
});

describe('distributeLayouts', () => {
  it('equal horizontal gaps; the outer layouts (by center) stay put', () => {
    const d = fixture();
    // By center x: 0 (300), 2 (450), 1 (800). Span 200–880 holds 200 + 100 + 160 → gaps of 110.
    expect(distributeLayouts(d, 'h')).toBe(true);
    const [a, b, c] = rects(d); // slots 0 (first), 1 (last), 2 (between)
    expect([a.l, b.l]).toEqual([200, 720]);
    expect(c.l - (a.l + a.w)).toBeCloseTo(110, 9);
    expect(b.l - (c.l + c.w)).toBeCloseTo(110, 9);
    expect(c.t).toBe(1050); // the other axis is untouched
  });

  it('equal vertical gaps', () => {
    const d = fixture();
    // By center y: 1 (250), 0 (400), 2 (1100). Span 200–1150 holds 100 + 200 + 100 → gaps of 275.
    expect(distributeLayouts(d, 'v')).toBe(true);
    const [a, b, c] = rects(d);
    expect([b.t, c.t]).toEqual([200, 1050]);
    expect(a.t - (b.t + b.h)).toBeCloseTo(275, 9);
    expect(c.t - (a.t + a.h)).toBeCloseTo(275, 9);
  });

  it('gives overlapping layouts equal overlaps', () => {
    const d = fixture();
    d.slots[0].cx = 700; // x 600–800, overlapping layout 1 (720–880)
    d.slots[2].cx = 750; // x 700–800
    distributeLayouts(d, 'h');
    const [a, b, c] = rects(d).map((r) => [r.l, r.l + r.w]);
    // By center x: 0 (700), 2 (750), 1 (800): span 600–880 holds 460 → gaps of −90.
    expect(c[0] - a[1]).toBeCloseTo(-90, 9);
    expect(b[0] - c[1]).toBeCloseTo(-90, 9);
  });

  it('reports no change when already spaced', () => {
    const d = fixture();
    distributeLayouts(d, 'h');
    const once = JSON.stringify(d);
    expect(distributeLayouts(d, 'h')).toBe(false);
    expect(JSON.stringify(d)).toBe(once);
  });

  it('needs 3 visible layouts', () => {
    expect(canDistribute(fixture(2))).toBe(false);
    expect(canDistribute(fixture(3))).toBe(true);
    const d = fixture(2);
    const before = JSON.stringify(d);
    expect(distributeLayouts(d, 'h')).toBe(false);
    expect(JSON.stringify(d)).toBe(before);
  });
});
