/* The All pages image (lib/pages-grid.ts): where the pages go on each canvas, which pages it shows,
   and its place in the Etsy listing set and the All pages export. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { type Composition, type MediaItem } from '@/lib/model';
import { gridCells, gridPages, gridSlots, hasPages, PAGE_WINDOW_AR } from '@/lib/pages-grid';
import { rectOf } from '@/lib/render/units';
import { etsySet, pagesImages } from '@/lib/sets';

const item = (k: number | string): MediaItem => ({ imageId: `img_${k}`, name: `${k}.png`, source: { kind: 'file' }, nw: 1440, nh: 4000 });
const withMedia = (n: number): Composition => ({ ...defaultComposition(), media: Array.from({ length: n }, (_, k) => item(k)) });

describe('gridCells', () => {
  it('8 pages on Etsy 4:3: two rows of four, inside the margins, centered', () => {
    const cells = gridCells(3000, 2250, 8);
    expect(new Set(cells.map((c) => Math.round(c.cy))).size).toBe(2);
    const rects = cells.map((c) => rectOf({ ...item(0), crop: 'custom', ar: PAGE_WINDOW_AR, fx: 50, fy: 0, ...c }));
    const l = Math.min(...rects.map((r) => r.l)), r = Math.max(...rects.map((x) => x.l + x.w));
    const t = Math.min(...rects.map((x) => x.t)), b = Math.max(...rects.map((x) => x.t + x.h));
    expect(l).toBeCloseTo(3000 - r, 6);
    expect(t).toBeCloseTo(2250 - b, 6);
    expect(Math.min(l, t)).toBeGreaterThanOrEqual(2250 * 0.08 - 1e-6);
  });

  it('a short last row is centered; one page fills the canvas', () => {
    const cells = gridCells(2000, 2000, 8);
    const rows = [...new Set(cells.map((c) => Math.round(c.cy)))];
    expect(rows).toHaveLength(3);
    const last = cells.filter((c) => Math.round(c.cy) === rows[2]);
    expect(last).toHaveLength(2);
    expect((last[0].cx + last[1].cx) / 2).toBeCloseTo(1000, 6);
    const [one] = gridCells(1000, 1500, 1);
    expect(one.cx).toBeCloseTo(500, 6);
    expect(one.w).toBeCloseTo(1000 - 160, 6); // the full width inside the margins
  });

  it('nothing for no pages', () => {
    expect(gridCells(1000, 1500, 0)).toEqual([]);
  });
});

describe('gridPages', () => {
  it('Media in its order; with fewer than two there, the visible layouts, each once', () => {
    expect(gridPages(withMedia(5)).map((p) => p.imageId)).toEqual(['img_0', 'img_1', 'img_2', 'img_3', 'img_4']);
    const d = defaultComposition();
    d.slots[1].imageId = d.slots[0].imageId;
    expect(gridPages(d)).toHaveLength(1);
  });

  it('needs two real pages', () => {
    expect(hasPages(defaultComposition())).toBe(false);
    expect(hasPages(withMedia(1))).toBe(false);
    expect(hasPages(withMedia(2))).toBe(true);
  });

  it('each page shows from its top in a portrait window', () => {
    const slots = gridSlots(gridPages(withMedia(3)), 3000, 2250);
    expect(slots.map((s) => [s.crop, s.ar, s.fx, s.fy])).toEqual(Array(3).fill(['custom', PAGE_WINDOW_AR, 50, 0]));
  });
});

describe('in the exports', () => {
  it('the Etsy set has All pages after the hero once Media has two pages', () => {
    expect(etsySet(defaultComposition(), null).map((i) => i.key)).not.toContain('all-pages');
    const set = etsySet(withMedia(6), null);
    expect(set.map((i) => i.key).slice(0, 2)).toEqual(['hero', 'all-pages']);
    const pages = set[1];
    expect(pages.kind === 'pages' && [pages.doc.W, pages.doc.H, pages.pages.length]).toEqual([3000, 2250, 6]);
  });

  it('the Etsy set then has each page not on the hero on its own, the palette last, at most 20', () => {
    const src = withMedia(6);
    for (const [i, k] of [[0, 0], [1, 1]] as const) Object.assign(src.slots[i], item(k));
    const set = etsySet(src, null);
    const pages = set.filter((i) => i.key.startsWith('page-'));
    expect(pages.map((i) => i.label)).toEqual(['2.png', '3.png', '4.png', '5.png']);
    for (const p of pages) expect(p.kind === 'composition' && [p.doc.W, p.doc.count, p.doc.arrangement, p.doc.slots[0].crop]).toEqual([3000, 1, 'showcase', 'full']);
    expect(set.at(-1)!.key).toBe('palette');
    const big = withMedia(12);
    const all = etsySet(big, null);
    expect(all.length).toBeLessThanOrEqual(20);
    expect(all.at(-1)!.key).toBe('palette');
    expect(all.filter((i) => i.key.startsWith('page-')).length).toBe(12);
  });

  it('All pages comes at Etsy 4:3, pin and Etsy square', () => {
    expect(pagesImages(withMedia(4)).map((i) => [i.doc.W, i.doc.H, i.pages.length])).toEqual([[3000, 2250, 4], [1000, 1500, 4], [2000, 2000, 4]]);
  });
});
