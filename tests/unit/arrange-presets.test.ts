/* The layout presets after the cascades: the panel's list per count, and the columns, grid and
   spotlight arrangements (positions, crops, a new image in a layout, switching sizes, the store). The
   image store is mocked (no IndexedDB here). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/images', () => {
  let next = 0;
  return {
    ingestImage: async () => ({ id: `img_${++next}`, nw: 1440, nh: 9000 }),
    loadImage: async () => null,
    releaseImage: () => {},
    pruneImages: async () => {},
    useImageUrl: () => null,
    useLoadedImage: () => null,
  };
});

import {
  applyArrangement, arrange, ARRANGEMENT_NAMES, canContinuePage, defaultComposition, presetArrangements, presetOf,
} from '@/lib/arrange';
import { isArranged, resizeCanvas } from '@/lib/canvas-size';
import { putImage } from '@/lib/media';
import { clone, defaultUi, type Arrangement, type Composition, type MediaItem, type Slot } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { cropRatio, rectOf, type Rect } from '@/lib/render/units';
import { forPreset } from '@/lib/sets';
import { useEditor } from '@/lib/store';

const CANVASES = { port: [1000, 1500], sq: [2000, 2000], land: [3000, 2250] } as const;
type Kind = keyof typeof CANVASES;
const KINDS = Object.keys(CANVASES) as Kind[];

const PHONE: Slot['source'] = { kind: 'url', url: 'https://x.test', capturedAt: '', options: { width: 390, fullPage: true, scale: 2, delayMs: 0, hideBanners: true, darkMode: false, hideSelectors: [] } };

/** Long pages (1440 wide, `nhs` tall) in arrangement `a`, started over as picking it does. */
function pages(kind: Kind, a: Arrangement, n: 1 | 2 | 3, nhs: number[] = [9000, 7000, 8000]): Composition {
  const d = defaultComposition();
  [d.W, d.H] = CANVASES[kind];
  d.count = n;
  d.slots.forEach((s, i) => Object.assign(s, { imageId: `p${i}`, nw: 1440, nh: nhs[i], fx: 50, fy: 0 }));
  applyArrangement(d, a, null);
  return d;
}
const rects = (d: Composition) => d.slots.slice(0, d.count).map((s) => rectOf(s));
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t));
/** Within a pixel: arrange() rounds centers and widths. */
const near = (v: number, x: number) => expect(Math.abs(v - x)).toBeLessThanOrEqual(1);
const inside = (r: Rect, W: number, H: number, m = 0) => r.l >= m - 1 && r.t >= m - 1 && r.l + r.w <= W - m + 1 && r.t + r.h <= H - m + 1;
const item = (id: string, nw = 1440, nh = 9000, source: Slot['source'] = { kind: 'file' }): MediaItem => ({ imageId: `img_${id}`, name: `${id}.png`, source, nw, nh });

describe('the presets panel', () => {
  it('offers no cascades: Scroll, Framed, Close-up; Columns, Split, Inset; Editorial, Columns, Bento, Spotlight', () => {
    const names = (n: 1 | 2 | 3) => presetArrangements(n).map((a) => ARRANGEMENT_NAMES[a][n]);
    expect(names(1)).toEqual(['Scroll', 'Framed', 'Close-up']);
    expect(names(2)).toEqual(['Columns', 'Split', 'Inset']);
    expect(names(3)).toEqual(['Editorial', 'Columns', 'Bento', 'Spotlight']);
    for (const n of [1, 2, 3] as const) expect(presetArrangements(n)).not.toContain('classic');
  });

  it('columns is showcase below three layouts', () => {
    expect([presetOf('columns', 1), presetOf('columns', 2), presetOf('columns', 3)]).toEqual(['showcase', 'showcase', 'columns']);
    for (const kind of KINDS) {
      for (const n of [1, 2] as const) expect(rects(pages(kind, 'columns', n))).toEqual(rects(pages(kind, 'showcase', n)));
    }
    expect(canContinuePage(pages('port', 'columns', 2, [9000, 9000]))).toBe(true);
  });
});

describe('columns: three', () => {
  it.each(KINDS)('%s: three whole pages, as wide as each other, side by side, the middle one higher', (kind) => {
    const d = pages(kind, 'columns', 3);
    const [a, b, c] = rects(d);
    expect(d.slots.slice(0, 3).map((s) => s.crop)).toEqual(['full', 'full', 'full']);
    expect(Math.abs(a.w - b.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.w - c.w)).toBeLessThanOrEqual(1);
    expect(b.l + b.w).toBeLessThan(a.l);
    expect(a.l + a.w).toBeLessThan(c.l);
    expect(Math.abs(b.l - (d.W - c.l - c.w))).toBeLessThanOrEqual(1); // even side margins
    expect(a.t).toBeLessThan(b.t);
    expect(Math.abs(b.t - c.t)).toBeLessThanOrEqual(1);
    expect(a.t + a.h).toBeGreaterThan(d.H); // long pages run off the bottom
    expect(d.order).toEqual([0, 1, 2]);
  });
});

describe('grid', () => {
  it.each(KINDS)('%s: every page fills its cell from the top; cells inside an even margin, apart', (kind) => {
    for (const n of [1, 2, 3] as const) {
      const d = pages(kind, 'grid', n);
      const m = 0.08 * Math.min(d.W, d.H);
      const rs = rects(d);
      for (const [i, r] of rs.entries()) {
        expect(inside(r, d.W, d.H, m), `${n}: ${i}`).toBe(true);
        expect(d.slots[i]).toMatchObject({ crop: 'custom', fy: 0 });
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(rs[i], rs[j])).toBe(0);
      // The group reaches the margin on all four sides.
      near(Math.min(...rs.map((r) => r.l)), m);
      near(Math.min(...rs.map((r) => r.t)), m);
      near(Math.max(...rs.map((r) => r.l + r.w)), d.W - m);
      near(Math.max(...rs.map((r) => r.t + r.h)), d.H - m);
      expect(d.order).toEqual([0, 1, 2]);
    }
  });

  it('Split stacks the two on portrait canvases and puts them side by side on the others', () => {
    const [a, b] = rects(pages('port', 'grid', 2));
    expect([a.l, a.w]).toEqual([b.l, b.w]);
    expect(b.t).toBeGreaterThan(a.t + a.h);
    for (const kind of ['sq', 'land'] as const) {
      const [c, e] = rects(pages(kind, 'grid', 2));
      expect(Math.abs(c.t - e.t)).toBeLessThanOrEqual(1);
      expect(e.l).toBeGreaterThan(c.l + c.w);
    }
  });

  it('Bento: one big cell and two small ones', () => {
    for (const kind of KINDS) {
      const [a, b, c] = rects(pages(kind, 'grid', 3));
      expect(a.w * a.h).toBeGreaterThan(b.w * b.h + c.w * c.h);
      expect(Math.abs(b.w * b.h - c.w * c.h)).toBeLessThan(0.01 * b.w * b.h);
    }
  });

  it('an image wider than its cell is shown whole inside it', () => {
    const d = defaultComposition();
    d.count = 2;
    Object.assign(d.slots[0], { nw: 1600, nh: 1000 });
    applyArrangement(d, 'grid', null);
    const s = d.slots[0];
    expect(s.crop).toBe('full');
    const r = rectOf(s), cell = rectOf(d.slots[1]);
    expect(r.w).toBeLessThanOrEqual(cell.w + 1);
    expect(r.t).toBeGreaterThanOrEqual(0.08 * 1000 - 1);
  });

  it('leaves room for a top headline', () => {
    const d = pages('port', 'grid', 3);
    Object.assign(d.overlays!.headline, { enabled: true, place: 'top', text: 'Headline' });
    arrange(d, 3, (t) => t.length * 0.55 * 80);
    expect(Math.min(...rects(d).map((r) => r.t))).toBeGreaterThan(0.08 * 1000 + 40);
    for (const r of rects(d)) expect(inside(r, 1000, 1500, 0.08 * 1000)).toBe(true);
  });

  it('a new image fills the same cell, from the top', () => {
    const d = pages('port', 'grid', 3);
    const before = rects(d)[1];
    d.slots[1].fy = 40;
    putImage(d, 1, item('new', 1440, 3000));
    const r = rectOf(d.slots[1]);
    expect(r.l).toBeCloseTo(before.l, 6);
    expect(r.t).toBeCloseTo(before.t, 6);
    expect(r.w).toBeCloseTo(before.w, 6);
    expect(r.h).toBeCloseTo(before.h, 6);
    expect(d.slots[1]).toMatchObject({ imageId: 'img_new', crop: 'custom', fy: 0 });
  });
});

describe('spotlight', () => {
  it.each(KINDS)('%s Close-up: the page whole, a little wider than the canvas, centered', (kind) => {
    const d = pages(kind, 'spotlight', 1);
    const [r] = rects(d);
    expect(d.slots[0].crop).toBe('full');
    expect(r.w).toBeCloseTo(1.1 * d.W, 0);
    expect(r.l + r.w / 2).toBeCloseTo(d.W / 2, 0);
    expect(r.t + r.h).toBeGreaterThan(d.H);
  });

  it('Close-up: a wide image is not pushed past the sides', () => {
    const d = pages('port', 'spotlight', 1, [900]);
    const [r] = rects(d);
    expect(inside(r, d.W, d.H)).toBe(true);
    expect(r.t + r.h / 2).toBeCloseTo(750, 0);
  });

  it.each(KINDS)('%s Inset: the page whole and one in front of its lower right edge, 4:5, overlapping it', (kind) => {
    const d = pages(kind, 'spotlight', 2);
    const [lead, front] = rects(d);
    expect(d.slots.slice(0, 2).map((s) => s.crop)).toEqual(['full', '4:5']);
    expect(lead.t + lead.h).toBeGreaterThan(d.H);
    expect(front.l + front.w).toBeGreaterThan(lead.l + lead.w);
    expect(lead.l + lead.w - front.l).toBeGreaterThanOrEqual(0.4 * front.w - 1);
    expect(front.l + front.w).toBeLessThanOrEqual(d.W);
    expect(front.t + front.h).toBeLessThan(d.H);
    expect(lead.l - 0).toBeCloseTo(d.W - front.l - front.w, 0); // the pair centered
    expect(d.order).toEqual([0, 1, 2]); // the one in front is in front
  });

  it('Inset: a phone page gets a phone screen and still overlaps the page', () => {
    for (const kind of KINDS) {
      const d = pages(kind, 'spotlight', 1);
      d.count = 2;
      Object.assign(d.slots[1], { nw: 780, nh: 12000, source: PHONE });
      applyArrangement(d, 'spotlight', null);
      const [lead, phone] = rects(d);
      expect(d.slots[1].crop).toBe('9:16');
      expect(phone.w).toBeLessThan(lead.w / 2);
      expect(overlap(lead, phone)).toBeGreaterThan(0.3 * phone.w * phone.h);
    }
  });

  it.each(KINDS)('%s Spotlight: the page centered, one in front of each edge, the left one higher', (kind) => {
    const d = pages(kind, 'spotlight', 3);
    const [lead, left, right] = rects(d);
    expect(lead.l + lead.w / 2).toBeCloseTo(d.W / 2, 0);
    expect(left.l).toBeLessThan(lead.l);
    expect(right.l + right.w).toBeGreaterThan(lead.l + lead.w);
    expect(left.t + left.h).toBeLessThan(right.t + right.h);
    for (const r of [left, right]) {
      expect(inside(r, d.W, d.H)).toBe(true);
      expect(overlap(lead, r)).toBeGreaterThan(0);
    }
  });

  it('a new image in front keeps its width and bottom edge, with its own crop', () => {
    const d = pages('port', 'spotlight', 2);
    const before = rects(d)[1];
    putImage(d, 1, item('phone', 780, 12000, PHONE));
    const r = rectOf(d.slots[1]);
    expect(d.slots[1].crop).toBe('9:16');
    expect(r.w).toBe(before.w);
    expect(r.t + r.h).toBeCloseTo(before.t + before.h, 6);
    putImage(d, 0, item('lead', 1440, 3000));
    expect(d.slots[0].crop).toBe('full');
  });
});

describe('saved and other sizes', () => {
  it('keeps the new arrangements when read back', () => {
    for (const a of ['columns', 'grid', 'spotlight'] as const) {
      const d = defaultComposition();
      applyArrangement(d, a, null);
      expect(sanitizeComposition(clone(d))!.arrangement).toBe(a);
    }
  });

  it('grid cells take each canvas’s shape, and coming back restores them', () => {
    const d = pages('port', 'grid', 3);
    const pin = clone(d.slots);
    resizeCanvas(d, 3000, 2250, null, 'etsy43');
    expect(isArranged(d)).toBe(true);
    expect(cropRatio(d.slots[0])).not.toBeCloseTo(cropRatio(pin[0]), 2);
    d.slots[0].cx += 10; // moved: Etsy 4:3 remembers it, cells and all
    resizeCanvas(d, 1000, 1500, null, 'pin');
    expect(d.slots.map((s) => [s.cx, s.cy, s.w, s.crop, s.ar])).toEqual(pin.map((s) => [s.cx, s.cy, s.w, s.crop, s.ar]));
    for (let i = 0; i < 3; i++) expect(rectOf(d.slots[i])).toEqual(rectOf(pin[i]));
    // Export all sizes on Etsy 4:3 uses what was left there, crops included.
    const etsy = forPreset(d, 'etsy43', null);
    const shapes = rects(etsy).map((r) => r.w / r.h);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(rects(etsy)[i], rects(etsy)[j])).toBe(0);
    expect(shapes[0]).not.toBeCloseTo(cropRatio(pin[0]), 2);
  });
});

/* ---------------- the store ---------------- */

const S = () => useEditor.getState();
const doc = () => S().doc;

describe('in the editor', () => {
  beforeEach(() => {
    S().loadComposition(defaultComposition());
    useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
  });

  it('a layout coming into view takes the arrangement’s crop', () => {
    S().setArrangement('spotlight');
    expect(doc().slots.slice(0, 2).map((s) => s.crop)).toEqual(['full', '4:5']);
    S().setCount(3);
    expect(doc().slots[2].crop).toBe('4:5');
    expect(isArranged(doc())).toBe(true);
    S().setArrangement('grid');
    S().setCount(2);
    S().setCount(3);
    expect(doc().slots.map((s) => s.crop)).toEqual(['custom', 'custom', 'custom']);
    expect(isArranged(doc())).toBe(true);
  });

  it('three columns stay picked through fewer layouts', () => {
    S().setCount(3);
    S().setArrangement('columns');
    S().setCount(2);
    expect(doc().arrangement).toBe('columns');
    S().setCount(3);
    expect(doc().arrangement).toBe('columns');
    expect(rects(doc())[0].t).toBeLessThan(rects(doc())[1].t);
  });

  it('a crop change keeps the lead page’s top edge in spotlight', () => {
    S().setArrangement('spotlight');
    const t = rects(doc())[0].t;
    S().setCrop(0, '1:2');
    expect(rects(doc())[0].t).toBeCloseTo(t, 6);
  });
});
