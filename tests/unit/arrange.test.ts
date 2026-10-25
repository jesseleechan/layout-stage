import { describe, expect, it } from 'vitest';
import { arrange, canContinuePage, canvasKind, defaultComposition, HEADLINE_GAP, layoutRoom, MIN_ROOM, pageMeasure } from '@/lib/arrange';
import { clone, STYLES, type Composition, type CropId, type PresetId } from '@/lib/model';
import type { Headline } from '@/lib/overlays';
import { layoutOverlays, REF_PX, type Measure } from '@/lib/render/overlay-layout';
import { cropRatio, rectOf, unit, type Rect } from '@/lib/render/units';

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
  d.arrangement = 'classic';
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
  it('is a pin with two sample pages as showcase columns in the Blush mesh style', () => {
    const d = defaultComposition();
    expect(d).toMatchObject({ preset: 'pin', W: 1000, H: 1500, count: 2, arrangement: 'showcase', order: [0, 1, 2] });
    expect(d.frame).toEqual(STYLES[0].frame);
    expect(d.background).toMatchObject({ type: 'mesh', meshSeed: 3, grain: 10 });
    expect(d.slots.map((s) => s.imageId)).toEqual(['sample:juniper', 'sample:northbeam', 'sample:fieldnote']);
    expect(d.slots.map((s) => s.crop)).toEqual(['full', 'full', 'full']);
    // Two 375 px columns; the 9:16 samples don't reach the bottom, so the staggered pair is centered.
    expect(d.slots.slice(0, 2).map((s) => [s.cx, s.cy, s.w])).toEqual([[288, 690, 375], [713, 810, 375]]);
  });
  it('returns a fresh copy each time', () => {
    const a = defaultComposition();
    a.slots[0].cx = 1;
    a.frame.shadow.blur = 1;
    expect(defaultComposition().slots[0].cx).toBe(288);
    expect(defaultComposition().frame.shadow.blur).toBe(80);
    expect(STYLES[0].frame.shadow.blur).toBe(80);
  });
});

/* ---------------- showcase ---------------- */

/** A long page, as a full-page capture is: 1440 wide, `nh` tall, shown whole. */
function pages(W: number, H: number, nhs: number[], ids = ['a', 'b', 'c']): Composition {
  const d = defaultComposition();
  d.W = W;
  d.H = H;
  d.arrangement = 'showcase';
  d.slots.forEach((s, i) => Object.assign(s, { imageId: ids[i], nw: 1440, nh: nhs[i] ?? 2560, crop: 'full', cx: -1, cy: -1, w: 1 }));
  return d;
}
const top = (d: Composition, i: number) => rectOf(d.slots[i]).t;
/** Within a pixel: arrange() rounds centers and widths. */
const near = (v: number, x: number) => expect(Math.abs(v - x)).toBeLessThanOrEqual(1);
const bottom = (d: Composition, i: number) => { const r = rectOf(d.slots[i]); return r.t + r.h; };

describe('showcase arrangement', () => {
  it('Scroll: one page, 80% wide, from 11.5% down, running off the bottom', () => {
    const d = pages(1000, 1500, [7680]);
    arrange(d, 1);
    expect(d.slots[0]).toMatchObject({ cx: 500, w: 800 });
    near(top(d, 0), 172.5);
    expect(bottom(d, 0)).toBeGreaterThan(1500);
    expect(d.order).toEqual([0, 1, 2]);
  });

  it('Scroll: a page too short to run off is centered', () => {
    const d = pages(1000, 1500, [900]);
    arrange(d, 1);
    expect(d.slots[0].cy).toBe(750);
    expect(d.slots[0].w).toBe(800);
  });

  it('Scroll: a phone capture is shown narrower', () => {
    const d = pages(1000, 1500, [8000]);
    d.slots[0].nw = 780;
    d.slots[0].source = { kind: 'url', url: 'https://x.test', capturedAt: '', options: { width: 390, fullPage: true, scale: 2, delayMs: 0, hideBanners: true, darkMode: false, hideSelectors: [] } };
    arrange(d, 1);
    expect(d.slots[0].w).toBe(460);
  });

  it('Columns: two pages from the top, the second lower, both running off the bottom', () => {
    const d = pages(1000, 1500, [7680, 7680]);
    arrange(d, 2);
    expect(d.slots.slice(0, 2).map((s) => [s.cx, s.w])).toEqual([[288, 375], [713, 375]]);
    near(top(d, 0), 100.5);
    near(top(d, 1), 220.5);
    expect(bottom(d, 0)).toBeGreaterThan(1500);
    expect(bottom(d, 1)).toBeGreaterThan(1500);
  });

  it('Columns: one page in both continues from the first column into the second', () => {
    // 1440 × 16000 at 375 wide is 4167 tall: longer than both columns.
    const d = pages(1000, 1500, [16000, 16000], ['a', 'a', 'c']);
    arrange(d, 2);
    // The first column shows the page from 100.5 px down to the bottom edge (1399.5 px of it)…
    near(top(d, 0), 100.5);
    // …the second the next 1399.5 px from the canvas top.
    near(top(d, 1), -1399.5);
  });

  it('Columns: a page shorter than two columns is split in half', () => {
    // 1440 × 7680 at 375 wide is 2000 tall: 1000 px in each column.
    const d = pages(1000, 1500, [7680, 7680], ['a', 'a', 'c']);
    arrange(d, 2);
    near(top(d, 0), 500);
    near(top(d, 1), -1000);
    near(bottom(d, 1), 1000);
  });

  it('Editorial: a hero in front of two lower windows that reach out to the sides', () => {
    const d = pages(1000, 1500, [7680, 7680, 7680]);
    arrange(d, 3);
    expect(d.slots.map((s) => [s.cx, s.w])).toEqual([[500, 460], [220, 340], [780, 340]]);
    near(top(d, 0), 240);
    near(top(d, 1), 337.5);
    near(top(d, 2), 337.5);
    expect(d.order).toEqual([1, 2, 0]);
  });

  for (const kind of ['port', 'sq', 'land'] as const) {
    it(`keeps every layout on a ${kind} canvas across its width`, () => {
      const [W, H] = CANVASES[kind];
      for (const n of [1, 2, 3] as const) {
        const d = pages(W, H, [7680, 5120, 7680]);
        arrange(d, n);
        for (let i = 0; i < n; i++) {
          const r = rectOf(d.slots[i]);
          expect(r.l).toBeGreaterThanOrEqual(0);
          expect(r.l + r.w).toBeLessThanOrEqual(W);
          expect(r.t).toBeGreaterThan(0);
        }
      }
    });
  }

  it('starts below a top headline, keeping the widths', () => {
    const d = pages(1000, 1500, [7680, 7680, 7680]);
    Object.assign(d.overlays!.headline, { enabled: true, place: 'top', text: 'A rather long headline that wraps onto two lines' });
    const room = layoutRoom(d, measure);
    expect(room.t).toBeGreaterThan(240);
    arrange(d, 3, measure);
    expect(top(d, 0)).toBeCloseTo(room.t, 0);
    expect(d.slots[0].w).toBe(460);
    near(top(d, 1) - top(d, 0), 97.5);
  });

  it('canContinuePage: two showcase columns and a page longer than the first column’s room', () => {
    expect(canContinuePage(pages(1000, 1500, [7680, 2560]))).toBe(true); // 2000 tall at 375 wide
    expect(canContinuePage(pages(1000, 1500, [2560, 2560]))).toBe(false); // 667: fits in one column
    const three = pages(1000, 1500, [7680, 2560]);
    three.count = 3;
    expect(canContinuePage(three)).toBe(false);
    const cropped = pages(1000, 1500, [7680, 2560]);
    cropped.slots[0].crop = '9:16';
    expect(canContinuePage(cropped)).toBe(false);
    const classic = pages(1000, 1500, [7680, 2560]);
    classic.arrangement = 'classic';
    expect(canContinuePage(classic)).toBe(false);
    const headed = pages(1000, 1500, [7680, 2560]);
    Object.assign(headed.overlays!.headline, { enabled: true, place: 'top', text: 'Headline' });
    expect(canContinuePage(headed, measure)).toBe(false);
  });

  it('never continues a page under a top headline', () => {
    const d = pages(1000, 1500, [16000, 16000], ['a', 'a', 'c']);
    Object.assign(d.overlays!.headline, { enabled: true, place: 'top', text: 'Headline' });
    arrange(d, 2, measure);
    expect(top(d, 1)).toBeGreaterThan(top(d, 0));
  });
});

/* ---------------- room for the headline ---------------- */

/** Stands in for the canvas's text measure (node has none): every character is 0.55 em wide. */
const measure: Measure = (text) => text.length * 0.55 * REF_PX;
const PRESET_OF: Record<keyof typeof CANVASES, PresetId> = { port: 'pin', sq: 'etsy11', land: 'etsy43' };

/** A canvas of the kind's preset with the headline switched on. */
function headed(kind: keyof typeof CANVASES, patch: Partial<Headline> = {}, crops?: CropId[]): Composition {
  const [W, H] = CANVASES[kind];
  const d = docOf(W, H, crops);
  d.preset = PRESET_OF[kind];
  Object.assign(d.overlays!.headline, { enabled: true, ...patch });
  return d;
}
function plainOf(kind: keyof typeof CANVASES, n: 1 | 2 | 3, crops?: CropId[]): Composition {
  const d = headed(kind, {}, crops);
  d.overlays!.headline.enabled = false;
  arrange(d, n);
  return d;
}
const visible = (d: Composition, n: number) => d.slots.slice(0, n).map((s) => rectOf(s));
const headlineBox = (d: Composition): Rect => layoutOverlays(d, measure).headline!.box;
const spots = (d: Composition) => d.slots.map((s) => [s.cx, s.cy, s.w]);
function bounds(rs: Rect[]) {
  const t = Math.min(...rs.map((r) => r.t)), b = Math.max(...rs.map((r) => r.t + r.h));
  const l = Math.min(...rs.map((r) => r.l)), r = Math.max(...rs.map((q) => q.l + q.w));
  return { t, b, h: b - t, cx: (l + r) / 2 };
}

describe('arrange with a headline', () => {
  it('places exactly as without one when the headline is off, in the middle, or there is no measure', () => {
    for (const kind of ['port', 'sq', 'land'] as const) {
      for (const n of [1, 2, 3] as const) {
        const plain = plainOf(kind, n);
        const off = headed(kind);
        off.overlays!.headline.enabled = false;
        const middle = headed(kind, { place: 'middle' });
        const unmeasured = headed(kind, { place: 'top' });
        arrange(off, n, measure);
        arrange(middle, n, measure);
        arrange(unmeasured, n);
        for (const d of [off, middle, unmeasured]) {
          expect(spots(d)).toEqual(spots(plain));
          expect(d.order).toEqual(plain.order);
        }
      }
    }
  });

  it('outside a browser the app has no measure, so the headline is ignored there', () => {
    expect(pageMeasure()).toBeNull();
  });

  for (const kind of ['port', 'sq', 'land'] as const) {
    for (const n of [1, 2, 3] as const) {
      it(`fits ${n} below a top headline and above a bottom one on a ${kind} canvas`, () => {
        for (const crops of [['16:10', '16:10', '16:10'], ['9:16', '4:5', 'full']] as CropId[][]) {
          const top = headed(kind, { place: 'top' }, crops);
          arrange(top, n, measure);
          const tb = headlineBox(top), gap = HEADLINE_GAP * unit(top.W, top.H);
          expect(layoutRoom(top, measure)).toEqual({ t: tb.t + tb.h + gap, b: top.H });
          for (const r of visible(top, n)) {
            expect(r.t).toBeGreaterThanOrEqual(tb.t + tb.h + gap - 1);
            expect(r.t + r.h).toBeLessThanOrEqual(top.H + 1);
            expect(r.l).toBeGreaterThanOrEqual(-1);
            expect(r.l + r.w).toBeLessThanOrEqual(top.W + 1);
          }
          const bottom = headed(kind, { place: 'bottom' }, crops);
          arrange(bottom, n, measure);
          const bb = headlineBox(bottom);
          expect(layoutRoom(bottom, measure)).toEqual({ t: 0, b: bb.t - gap });
          for (const r of visible(bottom, n)) {
            expect(r.t).toBeGreaterThanOrEqual(-1);
            expect(r.t + r.h).toBeLessThanOrEqual(bb.t - gap + 1);
          }
        }
      });
    }
  }

  it('keeps the arrangement: one scale for every layout, the same offsets between them, the same layer order', () => {
    const crops: CropId[] = ['9:16', '16:10', '4:5'];
    for (const kind of ['port', 'sq', 'land'] as const) {
      for (const n of [2, 3] as const) {
        for (const place of ['top', 'bottom'] as const) {
          const plain = plainOf(kind, n, crops);
          const d = headed(kind, { place }, crops);
          arrange(d, n, measure);
          expect(d.order).toEqual(plain.order);
          const sum = (x: Composition) => x.slots.slice(0, n).reduce((a, s) => a + s.w, 0);
          const k = sum(d) / sum(plain);
          expect(k).toBeLessThanOrEqual(1);
          for (let i = 1; i < n; i++) {
            expect(Math.abs(d.slots[i].w - plain.slots[i].w * k)).toBeLessThan(2);
            expect(Math.abs(d.slots[i].cx - d.slots[0].cx - (plain.slots[i].cx - plain.slots[0].cx) * k)).toBeLessThan(2);
            expect(Math.abs(d.slots[i].cy - d.slots[0].cy - (plain.slots[i].cy - plain.slots[0].cy) * k)).toBeLessThan(2);
          }
          // Scaled about the canvas's vertical center line, so the group stays as centered as it was.
          expect(Math.abs(bounds(visible(d, n)).cx - d.W / 2 - (bounds(visible(plain, n)).cx - d.W / 2) * k)).toBeLessThan(2);
        }
      }
    }
  });

  it('moves a group that fits without scaling it, centered in the room it has', () => {
    // The default pin: two 16:10 samples, 878 px tall together, under the default headline.
    const d = headed('port', { place: 'top' });
    arrange(d, 2, measure);
    expect(d.slots.slice(0, 2).map((s) => s.w)).toEqual([780, 780]);
    expect(d.slots[1].cx - d.slots[0].cx).toBe(200);
    expect(d.slots[1].cy - d.slots[0].cy).toBe(390);
    const room = layoutRoom(d, measure), g = bounds(visible(d, 2));
    expect(Math.abs(g.t - room.t - (room.b - g.b))).toBeLessThan(2);
    expect(g.t).toBeGreaterThan(room.t + 50);
  });

  it('scales a group down only as far as it has to', () => {
    // 16:10 3-up on the pin: 82% of the canvas tall, so it shrinks to fill 86% of the room.
    const wide = headed('port', { place: 'top' });
    arrange(wide, 3, measure);
    const room = layoutRoom(wide, measure);
    expect(Math.abs(bounds(visible(wide, 3)).h - 0.86 * (room.b - room.t))).toBeLessThan(1.5);
    // A 9:16 3-up fills the pin from top to bottom, so it fills the room the same way.
    const tall = headed('port', { place: 'top' }, ['9:16', '9:16', '9:16']);
    arrange(tall, 3, measure);
    const g = bounds(visible(tall, 3));
    expect(Math.abs(g.t - room.t)).toBeLessThan(1.5);
    expect(Math.abs(g.b - room.b)).toBeLessThan(1.5);
    expect(Math.abs(tall.slots[0].w - 405 * ((room.b - room.t) / 1500))).toBeLessThanOrEqual(0.5);
  });

  it('measures the headline as it is drawn: its text, size, fill and offset move the room', () => {
    const roomTop = (patch: Partial<Headline>) => layoutRoom(headed('port', { place: 'top', ...patch }), measure).t;
    const base = roomTop({});
    expect(roomTop({ text: 'Calm' })).toBeLessThan(base); // one line
    expect(roomTop({ text: 'Calm theme', size: 120 })).toBeGreaterThan(roomTop({ text: 'Calm' }));
    expect(roomTop({ fill: 'pill' })).toBeGreaterThan(base);
    expect(roomTop({ fill: 'band' })).toBeGreaterThan(base);
    expect(roomTop({ dy: 60 })).toBeCloseTo(base + 60, 6); // pin: 1 unit = 1 px
    // Nothing to draw, nothing to leave room for.
    expect(roomTop({ text: '  ' })).toBe(0);
  });

  it('keeps at least a quarter of the canvas for the layouts', () => {
    // Custom 2000 × 1000: a two-line pill headline at the largest size is taller than three quarters.
    const top = docOf(2000, 1000);
    top.preset = 'custom';
    Object.assign(top.overlays!.headline, { enabled: true, place: 'top', text: 'Hi\nYo', size: 220, fill: 'pill' });
    const box = headlineBox(top);
    expect(box.t + box.h + HEADLINE_GAP).toBeGreaterThan(750);
    expect(layoutRoom(top, measure)).toEqual({ t: 1000 * (1 - MIN_ROOM), b: 1000 });
    arrange(top, 2, measure);
    for (const r of visible(top, 2)) expect(r.t).toBeGreaterThanOrEqual(749);
    const bottom = clone(top);
    bottom.overlays!.headline.place = 'bottom';
    expect(layoutRoom(bottom, measure)).toEqual({ t: 0, b: 1000 * MIN_ROOM });
  });
});
