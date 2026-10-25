/* The editor store in node: no DOM, no IndexedDB. The store only touches storage after init() has
   hydrated it, and images only when a blob is placed, so the actions below run as pure state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrange, defaultComposition } from '@/lib/arrange';
import { clone, GRADS, MESHES, PRESETS, SHADOWS, STYLES, defaultUi, type Composition } from '@/lib/model';
import { capHeight, cropRatio, groupBounds, rectOf } from '@/lib/render/units';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();
const doc = () => S().doc;

function load(d: Composition = defaultComposition(), selected: number | null = null) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected }, toast: null });
}

/** A default pin with three samples where slot 0 has been dragged off its starting spot. */
function moved(): Composition {
  const d = defaultComposition();
  d.count = 3;
  arrange(d);
  d.slots[0].cx += 37;
  d.slots[0].cy -= 51;
  return d;
}

beforeEach(() => load());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('store basics', () => {
  it('imports in node and starts unhydrated with the default composition', () => {
    expect(S().hydrated).toBe(false);
    expect(doc()).toEqual(defaultComposition());
    expect([S().canUndo, S().canRedo]).toEqual([false, false]);
  });

  it('loadComposition resets history, clears the selection and keeps its own copy', () => {
    S().setCount(3);
    S().select(1);
    const d = moved();
    S().loadComposition(d);
    expect([S().canUndo, S().canRedo, S().ui.selected]).toEqual([false, false, null]);
    d.slots[0].cx = -999;
    expect(doc().slots[0].cx).not.toBe(-999);
  });
});

describe('live edits and commit', () => {
  it('edit() never saves an undo step; commit() saves one', () => {
    const before = clone(doc());
    S().edit((d) => { d.slots[0].cx = 123; });
    S().edit((d) => { d.slots[0].cy = 456; });
    expect(doc().slots[0]).toMatchObject({ cx: 123, cy: 456 });
    expect(S().canUndo).toBe(false);
    S().commit();
    expect(S().canUndo).toBe(true);
    S().undo();
    expect(doc()).toEqual(before);
    expect(S().canUndo).toBe(false);
  });

  it('commit() without a change saves nothing', () => {
    S().commit();
    S().edit(() => {});
    S().commit();
    expect(S().canUndo).toBe(false);
  });

  it('edit() replaces the doc object (no mutation of the previous state)', () => {
    const prev = doc();
    S().edit((d) => { d.frame.radius = 3; });
    expect(prev.frame.radius).toBe(14);
    expect(doc()).not.toBe(prev);
  });

  it('live slider actions (setScroll, setWidth, editFrame, editShadow, editBackground) wait for commit', () => {
    S().setScroll(0, 40);
    S().setWidth(0, 500);
    S().editFrame({ radius: 30, borderW: 2 });
    S().editShadow({ blur: 10 });
    S().editBackground({ grain: 33 });
    expect(S().canUndo).toBe(false);
    expect(doc().slots[0]).toMatchObject({ fy: 40, w: 500 });
    expect(doc().frame).toMatchObject({ radius: 30, borderW: 2 });
    expect(doc().background.grain).toBe(33);
    S().commit();
    S().undo();
    expect(doc()).toEqual(defaultComposition());
  });

  it('setScroll moves fy on a scrolling crop and fx on a panning one', () => {
    S().setScroll(0, 70);
    expect(doc().slots[0]).toMatchObject({ fy: 70, fx: 50 });
    S().edit((d) => { Object.assign(d.slots[1], { nw: 3000, nh: 1000, crop: '1:1' }); });
    S().setScroll(1, 20);
    expect(doc().slots[1]).toMatchObject({ fx: 20, fy: 0 });
  });

  it('nudge saves one step after 350 ms idle', () => {
    vi.useFakeTimers();
    load(defaultComposition(), 0);
    S().nudge(1, 0);
    S().nudge(10, 0);
    S().nudge(0, -1);
    expect(doc().slots[0]).toMatchObject({ cx: 411, cy: 554 });
    vi.advanceTimersByTime(349);
    expect(S().canUndo).toBe(false);
    vi.advanceTimersByTime(1);
    expect(S().canUndo).toBe(true);
    S().undo();
    expect(doc().slots[0]).toMatchObject({ cx: 400, cy: 555 });
    expect(S().canUndo).toBe(false);
  });

  it('nudge does nothing without a visible selection', () => {
    vi.useFakeTimers();
    load(defaultComposition(), 2); // count is 2
    S().nudge(5, 5);
    vi.advanceTimersByTime(1000);
    expect(doc()).toEqual(defaultComposition());
    expect(S().canUndo).toBe(false);
  });
});

describe('undo / redo', () => {
  it('redo re-applies, and a new action clears redo', () => {
    S().setCount(3);
    const three = clone(doc());
    S().undo();
    expect(S().canRedo).toBe(true);
    S().redo();
    expect(doc()).toEqual(three);
    S().undo();
    S().pickSolid('#FFFFFF');
    expect(S().canRedo).toBe(false);
  });

  it('undo clears a selection that is ≥ count and keeps one that is still visible', () => {
    S().setCount(3);
    S().select(2);
    S().undo();
    expect(doc().count).toBe(2);
    expect(S().ui.selected).toBeNull();

    S().setCount(3);
    S().select(1);
    S().undo();
    expect(S().ui.selected).toBe(1);
  });

  it('undo discards uncommitted live edits', () => {
    S().setCount(3);
    S().edit((d) => { d.slots[0].cx = 1; });
    S().undo();
    expect(doc()).toEqual(defaultComposition());
  });
});

describe('canvas and layouts', () => {
  it('setCount re-arranges and clamps the selection', () => {
    load(defaultComposition(), 1);
    S().setCount(3);
    const want = defaultComposition();
    want.count = 3;
    arrange(want, 3);
    expect(doc()).toEqual(want);
    expect(S().ui.selected).toBe(1);

    S().select(2);
    S().setCount(1);
    expect(doc().count).toBe(1);
    expect(S().ui.selected).toBe(0);
  });

  it('setCount to the current count does nothing', () => {
    S().setCount(2);
    expect(S().canUndo).toBe(false);
  });

  it('setPreset sets W/H and the default export scale, and re-arranges', () => {
    S().setPreset('etsy43');
    expect(doc()).toMatchObject({ preset: 'etsy43', W: 3000, H: 2250 });
    expect(S().ui.exportScale).toBe(1);
    const want = clone(doc());
    arrange(want);
    expect(doc().slots).toEqual(want.slots);
    expect(doc().slots[0].cx).toBe(Math.round(0.27 * 3000)); // landscape 2-up

    S().setPreset('p45');
    expect(doc()).toMatchObject({ W: 1080, H: 1350 });
    expect(S().ui.exportScale).toBe(2);

    S().setPreset('custom'); // keeps the current size
    expect(doc()).toMatchObject({ preset: 'custom', W: 1080, H: 1350 });
    expect(S().ui.exportScale).toBe(PRESETS.custom.scale);
  });

  it('setCustomSize clamps each side to 200–6000 and re-arranges', () => {
    S().setPreset('custom');
    S().setCustomSize(100, 9000);
    expect(doc()).toMatchObject({ W: 200, H: 6000 });
    S().setCustomSize(1234.6, Number.NaN);
    expect(doc()).toMatchObject({ W: 1235, H: 200 });
    S().setCustomSize(1200, 900);
    expect(doc()).toMatchObject({ W: 1200, H: 900 });
    expect(doc().slots[0].cx).toBe(Math.round(0.27 * 1200));
  });

  it('centerSelected centers the selected layout on one axis', () => {
    load(moved(), 0);
    const before = clone(doc());
    S().centerSelected('h');
    expect(doc().slots[0].cx).toBe(500);
    expect(doc().slots[0].cy).toBe(before.slots[0].cy);
    S().centerSelected('v');
    expect(doc().slots[0].cy).toBe(750);
    expect(doc().slots.slice(1)).toEqual(before.slots.slice(1));
  });

  it('centerSelected does nothing without a visible selection', () => {
    load(moved(), null);
    S().centerSelected('h');
    load(defaultComposition(), 2);
    S().centerSelected('v');
    expect(S().canUndo).toBe(false);
  });

  it('centerGroup centers the bounding box of all visible layouts', () => {
    const d = moved();
    d.count = 2;
    d.slots[2].cx = 9999; // hidden: ignored
    load(d);
    const before = clone(doc());
    S().centerGroup();
    const b = groupBounds(doc());
    expect(b.l + b.w / 2).toBeCloseTo(500, 9);
    expect(b.t + b.h / 2).toBeCloseTo(750, 9);
    // moved together
    const dx = doc().slots[0].cx - before.slots[0].cx, dy = doc().slots[0].cy - before.slots[0].cy;
    expect(doc().slots[1].cx - before.slots[1].cx).toBeCloseTo(dx, 9);
    expect(doc().slots[1].cy - before.slots[1].cy).toBeCloseTo(dy, 9);
    expect(doc().slots[2]).toEqual(before.slots[2]);
  });

  it('layer swaps within the visible layouts and toasts at either end', () => {
    load(defaultComposition(), 0); // order [0, 1, 2], count 2
    S().layer(1);
    expect(doc().order).toEqual([1, 0, 2]);
    S().layer(1);
    expect(S().toast?.msg).toBe('Already in front.');
    expect(doc().order).toEqual([1, 0, 2]);
    S().layer(-1);
    expect(doc().order).toEqual([0, 1, 2]);
    S().layer(-1);
    expect(S().toast?.msg).toBe('Already at the back.');
    expect(doc().order).toEqual([0, 1, 2]);
  });

  it('layer keeps hidden layouts after the visible ones', () => {
    const d = defaultComposition();
    d.order = [2, 1, 0]; // slot 2 is hidden (count 2)
    load(d, 1); // visible order is [1, 0]: slot 1 is at the back
    S().layer(-1);
    expect(S().toast?.msg).toBe('Already at the back.');
    expect(doc().order).toEqual([2, 1, 0]);
    S().layer(1);
    expect(doc().order).toEqual([0, 1, 2]);
  });

  it('layer on a 3-up hero order', () => {
    const d = defaultComposition();
    d.W = d.H = 2000;
    d.count = 3;
    arrange(d); // [1, 2, 0]
    load(d, 2);
    S().layer(1);
    expect(doc().order).toEqual([1, 0, 2]);
  });

  it('removeSlot moves the layout to the end, lowers the count, fixes the order and clears the selection', () => {
    const d = defaultComposition();
    d.W = d.H = 2000;
    d.count = 3;
    arrange(d); // order [1, 2, 0]
    load(d, 0);
    const [s0, s1, s2] = clone(d.slots);
    S().removeSlot(0);
    expect(doc().count).toBe(2);
    expect(doc().slots).toEqual([s1, s2, s0]);
    expect(doc().order).toEqual([0, 1, 2]); // old 1 → 0, old 2 → 1, removed → 2
    expect(S().ui.selected).toBeNull();

    load(defaultComposition(), 1);
    const [a, b, c] = clone(doc().slots);
    S().removeSlot(1);
    expect(doc().count).toBe(1);
    expect(doc().slots).toEqual([a, c, b]);
    expect(doc().order).toEqual([0, 2, 1]);
    expect([...doc().order].sort()).toEqual([0, 1, 2]);
  });

  it('removeSlot keeps the last layout', () => {
    const d = defaultComposition();
    d.count = 1;
    load(d, 0);
    S().removeSlot(0);
    expect(doc().count).toBe(1);
    expect(S().canUndo).toBe(false);
  });

  it('setCrop caps the height at 90% of the canvas', () => {
    S().setCrop(0, '9:16'); // 780 wide would be 1387 tall on a 1500 canvas
    expect(doc().slots[0].crop).toBe('9:16');
    expect(doc().slots[0].w).toBe(Math.round(1350 * (9 / 16)));
    expect(rectOf(doc().slots[0]).h).toBeLessThanOrEqual(1350);
    S().setCrop(0, '16:10'); // shorter: width unchanged
    expect(doc().slots[0].w).toBe(Math.round(1350 * (9 / 16)));
    expect(cropRatio(doc().slots[0])).toBe(1.6);
  });

  it('rearrange restores the starting spots', () => {
    load(moved());
    S().rearrange();
    const want = moved();
    arrange(want);
    expect(doc()).toEqual(want);
  });
});

describe('frame', () => {
  it('editShadow marks the preset custom, except for color-only edits', () => {
    S().editShadow({ color: '#112233' });
    expect(doc().frame.shadow).toMatchObject({ preset: 'lifted', color: '#112233' });
    for (const k of ['blur', 'x', 'y', 'opacity'] as const) {
      load();
      S().editShadow({ [k]: 5 });
      expect(doc().frame.shadow.preset).toBe('custom');
      expect(doc().frame.shadow[k]).toBe(5);
    }
    load();
    S().editShadow({ color: '#000000', y: 3 });
    expect(doc().frame.shadow.preset).toBe('custom');
  });

  it('setShadowPreset applies the preset values and keeps the color', () => {
    for (const p of ['none', 'soft', 'lifted', 'float', 'hard'] as const) {
      S().setShadowPreset(p);
      expect(doc().frame.shadow).toEqual({ ...SHADOWS[p], preset: p, color: '#4A2533' });
    }
    expect(doc().frame.shadow).toEqual({ preset: 'hard', blur: 0, x: 14, y: 14, opacity: 1, color: '#4A2533' });
  });

  it('applyStyle replaces the frame and merges the background', () => {
    S().editBackground({ imageId: 'img_bg', imageName: 'bg.png', blur: 20, dim: 0.3 });
    S().commit();
    const before = clone(doc().background);
    const poster = STYLES[4];
    S().applyStyle(poster);
    expect(doc().frame).toEqual(poster.frame);
    expect(doc().frame).not.toBe(poster.frame);
    expect(doc().background).toEqual({ ...before, type: 'solid', solid: '#FFD54A', grain: 0 });
    // untouched fields survive: the mesh colors, the gradient, the photo
    expect(doc().background).toMatchObject({ mesh: before.mesh, grad: before.grad, imageId: 'img_bg', blur: 20, dim: 0.3 });

    S().applyStyle(STYLES[2]); // Midnight
    expect(doc().background).toMatchObject({ type: 'gradient', grad: { a: '#1B2244', b: '#3B2452', angle: 155 }, grain: 12, solid: '#FFD54A' });
    // the style objects themselves are never mutated by later edits
    S().editFrame({ radius: 77 });
    S().editBackground({ grad: { a: '#000000', b: '#000000', angle: 0 } });
    expect(STYLES[2].frame.radius).toBe(16);
    expect(STYLES[2].background.grad).toEqual({ a: '#1B2244', b: '#3B2452', angle: 155 });
  });
});

describe('background', () => {
  it('pickSolid / pickGradient / pickMesh switch the type and set the colors', () => {
    S().pickSolid('#DCE3D2');
    expect(doc().background).toMatchObject({ type: 'solid', solid: '#DCE3D2' });
    S().pickGradient(3);
    expect(doc().background).toMatchObject({ type: 'gradient', grad: { a: GRADS[3][0], b: GRADS[3][1], angle: GRADS[3][2] } });
    S().pickMesh(5);
    expect(doc().background).toMatchObject({ type: 'mesh', mesh: MESHES[5] });
    expect(doc().background.mesh).not.toBe(MESHES[5]);
    S().editBackground({ mesh: ['#000000', '#000000', '#000000', '#000000'] });
    expect(MESHES[5][0]).toBe('#0E1B2C');
  });

  it('setBackgroundType switches the type and asks for an image when there is none', () => {
    S().setBackgroundType('gradient');
    expect(doc().background.type).toBe('gradient');
    expect(S().toast).toBeNull();
    S().setBackgroundType('image');
    expect(doc().background.type).toBe('image');
    expect(S().toast?.msg).toBe('Upload an image, or blur one of your layouts.');
  });

  it('backgroundFromLayout blurs the selected layout (or layout 1)', () => {
    load(defaultComposition(), 1);
    S().backgroundFromLayout();
    expect(doc().background).toMatchObject({ type: 'image', imageId: 'sample:northbeam', imageName: 'Layout 2, blurred', blur: 40, dim: 0.06 });
    load(defaultComposition(), null);
    S().backgroundFromLayout();
    expect(doc().background).toMatchObject({ imageId: 'sample:juniper', imageName: 'Layout 1, blurred' });
  });

  it('shuffleMesh picks a new seed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    S().shuffleMesh();
    expect(doc().background.meshSeed).toBe(12345);
  });
});

describe('each discrete action is exactly one undo step', () => {
  const cases: [string, () => void, (() => void)?][] = [
    ['setCount', () => S().setCount(3)],
    ['setPreset', () => S().setPreset('etsy11')],
    ['setCustomSize', () => S().setCustomSize(1200, 900)],
    ['rearrange', () => S().rearrange(), () => load(moved())],
    ['centerSelected h', () => S().centerSelected('h'), () => load(moved(), 0)],
    ['centerSelected v', () => S().centerSelected('v'), () => load(moved(), 0)],
    ['centerGroup', () => S().centerGroup(), () => load(moved())],
    ['layer', () => S().layer(1), () => load(defaultComposition(), 0)],
    ['removeSlot', () => S().removeSlot(0), () => load(moved(), 0)],
    ['setCrop', () => S().setCrop(1, '1:1')],
    ['setShadowPreset', () => S().setShadowPreset('hard')],
    ['setBackgroundType', () => S().setBackgroundType('solid')],
    ['pickSolid', () => S().pickSolid('#2B2F3A')],
    ['pickGradient', () => S().pickGradient(7)],
    ['pickMesh', () => S().pickMesh(2)],
    ['shuffleMesh', () => { vi.spyOn(Math, 'random').mockReturnValue(0.5); S().shuffleMesh(); }],
    ['applyStyle', () => S().applyStyle(STYLES[5])],
    ['backgroundFromLayout', () => S().backgroundFromLayout(), () => load(defaultComposition(), 1)],
  ];

  for (const [name, act, setup] of cases) {
    it(name, () => {
      setup?.();
      expect(S().canUndo).toBe(false);
      const before = clone(doc());
      act();
      const after = clone(doc());
      expect(after).not.toEqual(before);
      expect(S().canUndo).toBe(true);
      S().undo();
      expect(doc()).toEqual(before);
      expect(S().canUndo).toBe(false); // exactly one step
      S().redo();
      expect(doc()).toEqual(after);
      expect(S().canRedo).toBe(false);
    });
  }
});

describe('helpers the store relies on', () => {
  it('capHeight matches the prototype rule used by setCrop', () => {
    const s = clone(defaultComposition().slots[0]);
    s.crop = '4:5';
    s.w = 1400;
    capHeight(s, 1500);
    expect(s.w).toBe(Math.round(1350 * 0.8));
  });
});
