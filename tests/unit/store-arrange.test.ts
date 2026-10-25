/* The store's starting arrangements with the headline on: Re-arrange, the 1/2/3 toggle, preset and
   custom size changes and files that add layouts start the layouts beyond a top or bottom headline,
   and turning the headline on or off, or editing it, moves nothing by itself. Node has no canvas, so
   `document` is stubbed with one whose text measure gives every character 0.55 em; the image store
   is mocked (no IndexedDB here). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/images', () => {
  let next = 0;
  return {
    ingestImage: async () => ({ id: `img_${++next}`, nw: 1440, nh: 2400 }),
    loadImage: async () => null,
    releaseImage: () => {},
    pruneImages: async () => {},
    useImageUrl: () => null,
    useLoadedImage: () => null,
  };
});

/** The canvas text measure the store arranges with, at REF_PX: 55 px per character. */
vi.stubGlobal('document', {
  createElement: () => ({ getContext: () => ({ font: '', measureText: (t: string) => ({ width: t.length * 55 }) }) }),
});

import { arrange, layoutRoom, pageMeasure } from '@/lib/arrange';
import { clone, defaultUi, type Composition } from '@/lib/model';
import type { Headline } from '@/lib/overlays';
import type { Measure } from '@/lib/render/overlay-layout';
import { rectOf } from '@/lib/render/units';
import { useEditor } from '@/lib/store';
import { classicComposition } from './helpers';

const measure: Measure = (t) => t.length * 55;
const S = () => useEditor.getState();
const doc = () => S().doc;
const spots = (d: Composition) => d.slots.map((s) => [s.cx, s.cy, s.w]);
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

function load(d: Composition = classicComposition()) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
}
const headline = (patch: Partial<Headline>) => S().setOverlay('headline', { enabled: true, ...patch });

/** The visible layouts are where arrange() puts them with the headline measured, inside the room
 *  the headline leaves, and that room is smaller than the canvas. */
function expectRoomLeft(place: 'top' | 'bottom') {
  const d = doc();
  const want = clone(d);
  arrange(want, d.count, measure);
  expect(spots(d)).toEqual(spots(want));
  const room = layoutRoom(d, measure);
  if (place === 'top') expect(room.t).toBeGreaterThan(d.H * 0.15);
  else expect(room.b).toBeLessThan(d.H * 0.85);
  for (let i = 0; i < d.count; i++) {
    const r = rectOf(d.slots[i]);
    expect(r.t).toBeGreaterThanOrEqual(room.t - 1);
    expect(r.t + r.h).toBeLessThanOrEqual(room.b + 1);
  }
}

beforeEach(() => load());

describe('arranging around the headline', () => {
  it('measures with the page’s canvas (stubbed here)', () => {
    expect(pageMeasure()).not.toBeNull();
    expect(pageMeasure()!('abc', '800 100px x')).toBe(165);
  });

  it('Re-arrange starts the layouts below a top headline, as one undo step', () => {
    const before = spots(doc());
    headline({ place: 'top' });
    expect(spots(doc())).toEqual(before); // switching it on moves nothing
    S().rearrange();
    expect(spots(doc())).not.toEqual(before);
    expectRoomLeft('top');
    S().undo();
    expect(spots(doc())).toEqual(before);
    expect(doc().overlays!.headline.enabled).toBe(true);
  });

  it('Re-arrange starts them above a bottom headline; a middle one arranges as before', () => {
    headline({ place: 'bottom' });
    S().rearrange();
    expectRoomLeft('bottom');
    S().setOverlay('headline', { place: 'middle' });
    S().rearrange();
    expect(spots(doc())).toEqual(spots(classicComposition()));
  });

  it('switching the headline off, moving it or editing its text moves nothing by itself', () => {
    headline({ place: 'top' });
    S().rearrange();
    const placed = spots(doc());
    S().editOverlay('headline', { text: 'A much longer headline that wraps onto two lines' });
    S().commit();
    S().setOverlay('headline', { place: 'bottom', size: 140 });
    S().setOverlay('headline', { enabled: false });
    expect(spots(doc())).toEqual(placed);
    S().rearrange();
    expect(spots(doc())).toEqual(spots(classicComposition()));
  });

  it('the 1/2/3 toggle, presets and custom sizes leave the room too', () => {
    headline({ place: 'top' });
    S().setCount(3);
    expectRoomLeft('top');
    S().setCount(1);
    expectRoomLeft('top');
    S().setPreset('etsy43');
    expectRoomLeft('top');
    S().setOverlay('headline', { place: 'bottom' });
    // Moving the headline moves nothing, so the layouts are no longer where arrange() would start
    // them: a new size would keep them as they are (lib/canvas-size.ts). Re-arranged, they're fresh.
    S().rearrange();
    S().setPreset('etsy11');
    expectRoomLeft('bottom');
    S().setCustomSize(1600, 1200);
    expectRoomLeft('bottom');
  });

  it('files dropped as new layouts start beyond the headline', async () => {
    headline({ place: 'top' });
    await S().placeFiles([file('a.png'), file('b.png'), file('c.png')], null);
    expect(doc().count).toBe(3);
    expectRoomLeft('top');
    // One file with no sample left to fill adds a layout, re-arranged.
    const d = clone(doc());
    d.count = 1;
    load(d);
    await S().placeFiles([file('d.png')], null);
    expect(doc().count).toBe(2);
    expectRoomLeft('top');
  });
});
