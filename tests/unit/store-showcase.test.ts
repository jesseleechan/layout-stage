/* The store with the showcase arrangements and canvas sizes: switching sizes keeps the work, picking
   an arrangement starts the layouts over with its crops, new images take the showcase place, and the
   second column can continue the first one's page. The image store is mocked (no IndexedDB here). */
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

import { arrange, defaultComposition } from '@/lib/arrange';
import { isArranged } from '@/lib/canvas-size';
import { clone, defaultUi, type Composition } from '@/lib/model';
import { rectOf } from '@/lib/render/units';
import { forPreset } from '@/lib/sets';
import { useEditor } from '@/lib/store';
import { classicComposition } from './helpers';

const S = () => useEditor.getState();
const doc = () => S().doc;
const spots = (d: Composition) => d.slots.slice(0, d.count).map((s) => [s.cx, s.cy, s.w]);
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

function load(d: Composition = defaultComposition()) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
}

beforeEach(() => load());

describe('switching canvas sizes keeps the work', () => {
  it('moved layouts stay as arranged, scaled to the new canvas, in one undo step', () => {
    S().edit((d) => { d.slots[0].cx += 60; d.slots[1].cy -= 80; });
    S().commit();
    const before = clone(doc());
    S().setPreset('etsy43');
    expect(doc()).toMatchObject({ preset: 'etsy43', W: 3000, H: 2250 });
    expect(doc().slots[1].cx - doc().slots[0].cx).toBeCloseTo((before.slots[1].cx - before.slots[0].cx) * 1.5, 6);
    expect(doc().slots[1].cy - doc().slots[0].cy).toBeCloseTo((before.slots[1].cy - before.slots[0].cy) * 1.5, 6);
    S().undo();
    expect(doc()).toEqual(before);
  });

  it('coming back restores the size exactly as you left it', () => {
    S().edit((d) => { d.slots[0].cx += 60; });
    S().commit();
    const pin = spots(doc());
    S().setPreset('etsy11');
    S().setPreset('p45');
    S().setPreset('pin');
    expect(spots(doc())).toEqual(pin);
  });

  it('untouched layouts start fresh in the new shape', () => {
    S().setPreset('etsy43');
    expect(isArranged(doc())).toBe(true);
    S().setCustomSize(1600, 900);
    expect(isArranged(doc())).toBe(true);
  });

  it('Export all sizes uses what you left on a size', () => {
    S().setPreset('etsy43');
    S().edit((d) => { d.slots[0].cx -= 200; });
    S().commit();
    const etsy = spots(doc());
    S().setPreset('pin');
    expect(spots(forPreset(doc(), 'etsy43', null))).toEqual(etsy);
  });
});

describe('arrangements', () => {
  it('starts in showcase; picking classic starts the layouts over with the crops a new image gets', () => {
    expect(doc().arrangement).toBe('showcase');
    S().setArrangement('classic');
    expect(doc().arrangement).toBe('classic');
    expect(doc().slots.slice(0, 2).map((s) => s.crop)).toEqual(['16:10', '16:10']);
    expect(isArranged(doc())).toBe(true);
    S().setArrangement('showcase');
    expect(doc().slots.slice(0, 2).map((s) => s.crop)).toEqual(['full', 'full']);
    expect(doc()).toEqual(defaultComposition());
    S().undo();
    expect(doc().arrangement).toBe('classic');
  });

  it('picking the arrangement already in use changes nothing', () => {
    S().edit((d) => { d.slots[0].cx += 60; });
    S().commit();
    const before = clone(doc());
    S().setArrangement('showcase');
    expect(doc()).toEqual(before);
  });

  it('layouts coming into view take the showcase crop', () => {
    const d = defaultComposition();
    d.slots[2].crop = '4:5';
    load(d);
    S().setCount(3);
    expect(doc().slots[2].crop).toBe('full');
    expect(doc().order).toEqual([1, 2, 0]);
  });

  it('a crop change in showcase keeps the layout’s width and top edge', () => {
    const t = rectOf(doc().slots[0]).t;
    const w = doc().slots[0].w;
    S().setCrop(0, '4:5');
    expect(doc().slots[0].w).toBe(w);
    expect(rectOf(doc().slots[0]).t).toBeCloseTo(t, 6);
  });
});

describe('new images in showcase', () => {
  it('fill the layouts whole and re-arrange while the layouts are fresh', async () => {
    await S().placeFiles([file('a.png')], null);
    const s = doc().slots[0];
    expect([s.imageId.startsWith('img_'), s.crop]).toEqual([true, 'full']);
    expect(isArranged(doc())).toBe(true);
    // 1440 × 9000 at 375 wide runs off the bottom.
    expect(rectOf(s).t + rectOf(s).h).toBeGreaterThan(1500);
  });

  it('keep the width and top edge of a layout you moved', async () => {
    S().edit((d) => { d.slots[1].cx += 30; d.slots[1].cy += 40; });
    S().commit();
    const before = clone(doc().slots[1]);
    await S().placeFiles([file('b.png')], 1);
    const s = doc().slots[1];
    expect(s.w).toBe(before.w);
    expect(s.cx).toBe(before.cx);
    expect(rectOf(s).t).toBeCloseTo(rectOf(before).t, 6);
  });

  it('classic keeps its auto crop and height cap', async () => {
    load(classicComposition());
    await S().placeFiles([file('a.png')], 0);
    const s = doc().slots[0];
    expect(s.crop).toBe('16:10');
    expect(rectOf(s).h).toBeLessThanOrEqual(1500 * 0.9);
  });
});

describe('continuePage', () => {
  it('shows layout 1’s page in layout 2, continued, as one undo step', async () => {
    await S().placeFiles([file('a.png'), file('b.png')], null);
    const first = doc().slots[0];
    const other = doc().slots[1].imageId;
    S().continuePage(1);
    const [a, b] = doc().slots;
    expect([b.imageId, b.nw, b.nh, b.crop, b.name]).toEqual([first.imageId, first.nw, first.nh, 'full', first.name]);
    // 1440 × 9000 at 375 wide is 2344 tall: half in each column.
    expect(rectOf(b).t).toBeLessThan(0);
    expect(rectOf(a).t + rectOf(a).h).toBeGreaterThan(1500);
    expect(isArranged(doc())).toBe(true);
    S().undo();
    expect(doc().slots[1].imageId).toBe(other);
  });

  it('does nothing for layout 1 or a hidden layout', () => {
    const before = clone(doc());
    S().continuePage(0);
    S().continuePage(2);
    expect(doc()).toEqual(before);
  });

  it('in classic it only swaps the image', () => {
    load(classicComposition());
    const before = spots(doc());
    S().continuePage(1);
    expect(doc().slots[1].imageId).toBe(doc().slots[0].imageId);
    const want = clone(doc());
    arrange(want);
    expect(spots(doc())).toEqual(spots(want));
    expect(spots(doc())[0]).toEqual(before[0]);
  });
});
