import { describe, expect, it } from 'vitest';
import { arrange, canvasKind, defaultComposition } from '@/lib/arrange';
import { STYLES, type Composition, type CropId } from '@/lib/model';
import { cropRatio, rectOf } from '@/lib/render/units';

/* Starting spots copied from reference/layout-stage.html: [cx fraction, cy fraction, width fraction]. */
const SPOTS = {
  port: { 1: [[0.5, 0.5, 0.84]], 2: [[0.4, 0.37, 0.78], [0.6, 0.63, 0.78]], 3: [[0.38, 0.24, 0.72], [0.5, 0.5, 0.72], [0.62, 0.76, 0.72]] },
  sq: { 1: [[0.5, 0.5, 0.8]], 2: [[0.38, 0.38, 0.66], [0.62, 0.62, 0.66]], 3: [[0.5, 0.6, 0.62], [0.3, 0.37, 0.5], [0.7, 0.37, 0.5]] },
  land: { 1: [[0.5, 0.5, 0.7]], 2: [[0.27, 0.5, 0.42], [0.73, 0.5, 0.42]], 3: [[0.5, 0.57, 0.52], [0.24, 0.42, 0.4], [0.76, 0.42, 0.4]] },
} as const;
const CAP = { 1: 0.86, 2: 0.6, 3: 0.48 } as const;
const CANVASES = { port: [1000, 1500], sq: [2000, 2000], land: [3000, 2250] } as const;

function docOf(W: number, H: number, crops: CropId[] = ['16:10', '16:10', '16:10']): Composition {
  const d = defaultComposition();
  d.W = W;
  d.H = H;
  d.slots.forEach((s, i) => { s.crop = crops[i]; s.cx = -1; s.cy = -1; s.w = 1; });
  d.order = [2, 1, 0];
  return d;
}

describe('canvasKind', () => {
  it('is landscape above 1.1, square above 0.9, portrait otherwise', () => {
    expect(canvasKind(3000, 2250)).toBe('land');
    expect(canvasKind(1101, 1000)).toBe('land');
    expect(canvasKind(1100, 1000)).toBe('sq');
    expect(canvasKind(2000, 2000)).toBe('sq');
    expect(canvasKind(901, 1000)).toBe('sq');
    expect(canvasKind(900, 1000)).toBe('port');
    expect(canvasKind(1080, 1350)).toBe('port');
    expect(canvasKind(1000, 1500)).toBe('port');
  });
});

describe('arrange', () => {
  for (const kind of ['port', 'sq', 'land'] as const) {
    for (const n of [1, 2, 3] as const) {
      it(`places ${n} on a ${kind} canvas at the prototype's spots`, () => {
        const [W, H] = CANVASES[kind];
        const d = docOf(W, H);
        arrange(d, n);
        SPOTS[kind][n].forEach(([fx, fy, fw], i) => {
          let w = fw * W;
          if (w / 1.6 > H * CAP[n]) w = H * CAP[n] * 1.6;
          expect(d.slots[i]).toMatchObject({ cx: Math.round(fx * W), cy: Math.round(fy * H), w: Math.round(w) });
        });
        // slots beyond n are untouched
        for (let i: number = n; i < 3; i++) expect(d.slots[i]).toMatchObject({ cx: -1, cy: -1, w: 1 });
      });
    }
  }

  it('matches hand-checked numbers on the pin', () => {
    const d = docOf(1000, 1500);
    arrange(d, 2);
    expect(d.slots.slice(0, 2).map((s) => [s.cx, s.cy, s.w])).toEqual([[400, 555, 780], [600, 945, 780]]);
  });

  it('caps the height at .86 / .6 / .48 of the canvas for 1 / 2 / 3 images', () => {
    // 9:16 crops are tall enough to hit the cap on a landscape canvas
    for (const n of [1, 2, 3] as const) {
      const d = docOf(3000, 2250, ['9:16', '9:16', '9:16']);
      arrange(d, n);
      for (let i = 0; i < n; i++) {
        const s = d.slots[i];
        expect(s.w).toBe(Math.round(2250 * CAP[n] * (9 / 16)));
        expect(Math.abs(rectOf(s).h - 2250 * CAP[n])).toBeLessThan(1);
      }
    }
  });

  it('caps each image by its own crop', () => {
    const d = docOf(1000, 1500, ['full', '16:10', '1:1']);
    arrange(d, 3);
    expect(d.slots[0].w).toBe(Math.round(1500 * 0.48 * cropRatio(d.slots[0]))); // full sample page is tall: capped
    expect(d.slots[1].w).toBe(720); // .72 × 1000, 450 tall: under the cap
    expect(d.slots[2].w).toBe(720); // 720 tall = exactly the cap
  });

  it('stacks portrait 3-ups in order and puts the hero on top of two behind on square and landscape', () => {
    const port = docOf(1000, 1500); arrange(port, 3);
    expect(port.order).toEqual([0, 1, 2]);
    const sq = docOf(2000, 2000); arrange(sq, 3);
    expect(sq.order).toEqual([1, 2, 0]);
    const land = docOf(3000, 2250); arrange(land, 3);
    expect(land.order).toEqual([1, 2, 0]);
    // the hero (slot 0) is the big, low, centered one
    expect(land.slots[0].w).toBeGreaterThan(land.slots[1].w);
    expect(land.slots[0].cx).toBe(1500);
  });

  it('always keeps all three indices in the order, visible ones first', () => {
    for (const [W, H] of Object.values(CANVASES)) {
      for (const n of [1, 2, 3] as const) {
        const d = docOf(W, H);
        arrange(d, n);
        expect([...d.order].sort()).toEqual([0, 1, 2]);
        expect([...d.order.slice(0, n)].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
        if (n < 3) expect(d.order).toEqual([0, 1, 2]);
      }
    }
  });

  it('defaults n to doc.count', () => {
    const d = docOf(2000, 2000);
    d.count = 3;
    arrange(d);
    expect(d.order).toEqual([1, 2, 0]);
  });
});

describe('defaultComposition', () => {
  it('is a pin with two arranged samples in the Blush mesh style', () => {
    const d = defaultComposition();
    expect(d).toMatchObject({ preset: 'pin', W: 1000, H: 1500, count: 2, order: [0, 1, 2] });
    expect(d.frame).toEqual(STYLES[0].frame);
    expect(d.background).toMatchObject({ type: 'mesh', meshSeed: 3, grain: 10 });
    expect(d.slots.map((s) => s.imageId)).toEqual(['sample:juniper', 'sample:northbeam', 'sample:fieldnote']);
    expect(d.slots.slice(0, 2).map((s) => [s.cx, s.cy, s.w])).toEqual([[400, 555, 780], [600, 945, 780]]);
  });
  it('returns a fresh copy each time', () => {
    const a = defaultComposition();
    a.slots[0].cx = 1;
    a.frame.shadow.blur = 1;
    expect(defaultComposition().slots[0].cx).toBe(400);
    expect(defaultComposition().frame.shadow.blur).toBe(80);
    expect(STYLES[0].frame.shadow.blur).toBe(80);
  });
});
