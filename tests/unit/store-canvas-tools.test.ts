/* Store actions for the canvas tools: align and distribute. Each click is exactly one undo step. */
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { defaultUi, type Composition } from '@/lib/model';
import { rectOf } from '@/lib/render/units';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();
const doc = () => S().doc;

/** Three layouts (see tests/unit/align.test.ts): x 200–400, 720–880, 400–500. */
function three(count: 1 | 2 | 3 = 3): Composition {
  const d = defaultComposition();
  d.count = count;
  d.slots[0] = { ...d.slots[0], crop: '1:1', w: 200, cx: 300, cy: 400 };
  d.slots[1] = { ...d.slots[1], crop: '16:10', w: 160, cx: 800, cy: 250 };
  d.slots[2] = { ...d.slots[2], crop: '1:1', w: 100, cx: 450, cy: 1100 };
  return d;
}
function load(d: Composition, selected: number | null) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected }, toast: null });
}

beforeEach(() => load(three(), 1));

describe('align', () => {
  it('moves the others to the selected layout in one undo step', () => {
    const before = JSON.stringify(doc());
    S().align('top');
    expect(doc().slots.slice(0, 3).map((s) => rectOf(s).t)).toEqual([200, 200, 200]);
    expect(S().canUndo).toBe(true);
    S().undo();
    expect(JSON.stringify(doc())).toBe(before);
    expect(S().canUndo).toBe(false);
  });

  it('toasts and saves nothing when already aligned', () => {
    S().align('left');
    S().undo();
    S().redo();
    S().align('left');
    expect(S().toast?.msg).toBe('Already aligned.');
    S().undo();
    expect(S().canUndo).toBe(false);
  });

  it('does nothing without a visible selection or with one layout', () => {
    load(three(), null);
    S().align('left');
    expect(S().canUndo).toBe(false);
    load(three(1), 0);
    S().align('left');
    expect([S().canUndo, S().toast]).toEqual([false, null]);
  });
});

describe('distribute', () => {
  it('equal gaps in one undo step', () => {
    const before = JSON.stringify(doc());
    S().distribute('h');
    expect(rectOf(doc().slots[2]).l).toBeCloseTo(510, 9);
    S().undo();
    expect(JSON.stringify(doc())).toBe(before);
    expect(S().canUndo).toBe(false);
  });

  it('toasts when already spaced; does nothing with fewer than 3 layouts', () => {
    S().distribute('v');
    S().distribute('v');
    expect(S().toast?.msg).toBe('Already evenly spaced.');
    S().undo();
    expect(S().canUndo).toBe(false);
    load(three(2), 0);
    S().distribute('h');
    expect([S().canUndo, S().toast]).toEqual([false, null]);
  });
});
