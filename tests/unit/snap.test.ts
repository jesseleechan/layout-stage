import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import type { Composition } from '@/lib/model';
import { snap, snapThreshold } from '@/lib/snap';
import { rectOf, safeArea } from '@/lib/render/units';

/** A 1000 × 1500 canvas (center lines x 500, y 750). Slot 0 is the dragged one, 200 × 200.
 *  Slot 1 is fixed: x 720 | 800 | 880, y 200 | 250 | 300. Slot 2 (hidden unless count is 3):
 *  x 100 | 200 | 300, y 1000 | 1100 | 1200. */
function fixture(count: 1 | 2 | 3 = 2): Composition {
  const d = defaultComposition();
  d.count = count;
  d.slots[0] = { ...d.slots[0], crop: '1:1', w: 200, cx: 0, cy: 0 };
  d.slots[1] = { ...d.slots[1], crop: '16:10', w: 160, cx: 800, cy: 250 };
  d.slots[2] = { ...d.slots[2], crop: '1:1', w: 200, cx: 200, cy: 1100 };
  return d;
}
const TH = 7;

describe('snapThreshold', () => {
  it('is 7 screen px in canvas px', () => {
    expect(snapThreshold(1)).toBe(7);
    expect(snapThreshold(0.5)).toBe(14);
    expect(snapThreshold(0.35)).toBeCloseTo(20);
  });
});

describe('snap', () => {
  it('fixture sanity', () => {
    expect(rectOf(fixture().slots[1])).toEqual({ l: 720, t: 200, w: 160, h: 100 });
  });

  it('snaps the dragged center to the canvas center lines', () => {
    expect(snap(fixture(), 0, 504, 745, TH)).toEqual({ cx: 500, cy: 750, gx: 500, gy: 750 });
    expect(snap(fixture(), 0, 496.5, 756.5, TH)).toEqual({ cx: 500, cy: 750, gx: 500, gy: 750 });
  });

  it('snaps the dragged edges to the canvas center lines', () => {
    // left edge (cx − 100) near 500
    expect(snap(fixture(), 0, 603, 1400, TH)).toEqual({ cx: 600, cy: 1400, gx: 500, gy: null });
    // right edge (cx + 100) near 500, bottom edge (cy + 100) near 750
    expect(snap(fixture(), 0, 395, 645, TH)).toEqual({ cx: 400, cy: 650, gx: 500, gy: 750 });
  });

  it("snaps the dragged center and edges to other images' edges and centers", () => {
    const d = fixture();
    expect(snap(d, 0, 804, 1400, TH)).toMatchObject({ cx: 800, gx: 800 }); // center → other's center
    expect(snap(d, 0, 983, 1400, TH)).toMatchObject({ cx: 980, gx: 880 }); // left edge → other's right edge
    expect(snap(d, 0, 622, 1400, TH)).toMatchObject({ cx: 620, gx: 720 }); // right edge → other's left edge
    expect(snap(d, 0, 100, 255, TH)).toMatchObject({ cy: 250, gy: 250 }); // center → other's middle
    expect(snap(d, 0, 100, 404, TH)).toMatchObject({ cy: 400, gy: 300 }); // top edge → other's bottom
    expect(snap(d, 0, 100, 97, TH)).toMatchObject({ cy: 100, gy: 200 }); // bottom edge → other's top
  });

  it('picks the closest target', () => {
    const d = fixture();
    // center 785 is 15 from 800; right edge 885 is 5 from 880
    expect(snap(d, 0, 785, 1400, 30)).toMatchObject({ cx: 780, gx: 880 });
    // center 795 is 5 from 800; right edge 895 is 15 from 880
    expect(snap(d, 0, 795, 1400, 30)).toMatchObject({ cx: 800, gx: 800 });
  });

  it('only snaps within the threshold (strictly less)', () => {
    const d = fixture();
    expect(snap(d, 0, 506.5, 1400, TH)).toMatchObject({ cx: 500, gx: 500 });
    expect(snap(d, 0, 507, 1400, TH)).toEqual({ cx: 507, cy: 1400, gx: null, gy: null });
    expect(snap(d, 0, 520, 1400, 21)).toMatchObject({ cx: 500, gx: 500 });
    expect(snap(d, 0, 520, 1400, TH)).toMatchObject({ cx: 520, gx: null });
  });

  it('snaps each axis independently', () => {
    expect(snap(fixture(), 0, 503, 1400, TH)).toEqual({ cx: 500, cy: 1400, gx: 500, gy: null });
    expect(snap(fixture(), 0, 30, 748, TH)).toEqual({ cx: 30, cy: 750, gx: null, gy: 750 });
  });

  it('returns the input and no guides when disabled (Alt held)', () => {
    expect(snap(fixture(), 0, 504, 745, TH, false)).toEqual({ cx: 504, cy: 745, gx: null, gy: null });
    expect(snap(fixture(), 0, 804, 255, TH, false)).toEqual({ cx: 804, cy: 255, gx: null, gy: null });
  });

  it('ignores hidden slots (index ≥ count)', () => {
    expect(snap(fixture(2), 0, 203, 1104, TH)).toEqual({ cx: 203, cy: 1104, gx: null, gy: null });
    expect(snap(fixture(3), 0, 203, 1104, TH)).toEqual({ cx: 200, cy: 1100, gx: 200, gy: 1100 });
  });

  it('never snaps to its own old position', () => {
    const d = fixture(1);
    d.slots[0].cx = 50;
    d.slots[0].cy = 60;
    expect(snap(d, 0, 52, 62, TH)).toEqual({ cx: 52, cy: 62, gx: null, gy: null });
  });

  it('does not mutate the doc', () => {
    const d = fixture();
    const before = JSON.stringify(d);
    snap(d, 0, 504, 745, TH);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('snap to the safe area (overlay on)', () => {
  // The pin's central 80%: x 100 | 500 | 900, y 150 | 750 | 1350.
  const SAFE = safeArea('inset', 1000, 1500);

  it('snaps the dragged edges to the safe area edges', () => {
    const d = fixture(1);
    // left edge (cx − 100) near 100, top edge (cy − 100) near 150
    expect(snap(d, 0, 204, 246, TH, true, SAFE)).toEqual({ cx: 200, cy: 250, gx: 100, gy: 150 });
    // right edge (cx + 100) near 900, bottom edge (cy + 100) near 1350
    expect(snap(d, 0, 795, 1253, TH, true, SAFE)).toEqual({ cx: 800, cy: 1250, gx: 900, gy: 1350 });
    // center near the safe area's left edge
    expect(snap(d, 0, 103, 1400, TH, true, SAFE)).toMatchObject({ cx: 100, gx: 100 });
  });

  it('snaps to the safe area center lines', () => {
    const d = fixture(1);
    const r = { l: 0, t: 300, w: 600, h: 400 }; // an off-center rect: center x 300, y 500
    expect(snap(d, 0, 304, 497, TH, true, r)).toEqual({ cx: 300, cy: 500, gx: 300, gy: 500 });
  });

  it('only while the overlay is on (a safe rect is passed), and never with Alt', () => {
    const d = fixture(1);
    expect(snap(d, 0, 204, 246, TH)).toEqual({ cx: 204, cy: 246, gx: null, gy: null });
    expect(snap(d, 0, 204, 246, TH, true, null)).toEqual({ cx: 204, cy: 246, gx: null, gy: null });
    expect(snap(d, 0, 204, 246, TH, false, SAFE)).toEqual({ cx: 204, cy: 246, gx: null, gy: null });
  });

  it('keeps the other targets and picks the closest', () => {
    const d = fixture();
    d.slots[0].w = 170; // half-width 85, so no two candidates tie
    // right edge 898 is 2 from the safe edge 900; the other layout's left edge 720 is 8 from 728
    expect(snap(d, 0, 813, 1400, 30, true, SAFE)).toMatchObject({ cx: 815, gx: 900 });
    // left edge 718 is 2 from the other layout's left edge 720; the safe edge 900 is 12 from 888
    expect(snap(d, 0, 803, 1400, 30, true, SAFE)).toMatchObject({ cx: 805, gx: 720 });
  });

  it('uses the Etsy 5:4 crop on a square canvas (y 100 | 500 | 900 on 1000)', () => {
    const d = fixture(1);
    d.W = 1000;
    d.H = 1000;
    const etsy = safeArea('etsy', 1000, 1000);
    expect(snap(d, 0, 30, 205, TH, true, etsy)).toEqual({ cx: 30, cy: 200, gx: null, gy: 100 });
  });
});
