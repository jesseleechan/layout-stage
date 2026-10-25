import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { History } from '@/lib/history';
import { HISTORY_LIMIT, type Composition } from '@/lib/model';

const at = (cx: number): Composition => {
  const d = defaultComposition();
  d.slots[0].cx = cx;
  return d;
};

describe('History', () => {
  it('starts empty', () => {
    const h = new History(at(0));
    expect([h.canUndo, h.canRedo, h.depth]).toEqual([false, false, 0]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('does not save a step when nothing changed', () => {
    const h = new History(at(0));
    expect(h.commit(at(0))).toBe(false);
    expect(h.canUndo).toBe(false);
    expect(h.commit(at(1))).toBe(true);
    expect(h.commit(at(1))).toBe(false);
    expect(h.depth).toBe(1);
  });

  it('undoes and redoes', () => {
    const h = new History(at(0));
    h.commit(at(1));
    h.commit(at(2));
    expect(h.undo()!.slots[0].cx).toBe(1);
    expect(h.undo()!.slots[0].cx).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo()!.slots[0].cx).toBe(1);
    expect(h.redo()!.slots[0].cx).toBe(2);
    expect(h.redo()).toBeNull();
    expect(h.undo()!.slots[0].cx).toBe(1);
  });

  it('a new commit clears redo', () => {
    const h = new History(at(0));
    h.commit(at(1));
    h.commit(at(2));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.commit(at(9));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()!.slots[0].cx).toBe(1);
  });

  it('committing the undone-to state is a no-op (keeps redo)', () => {
    const h = new History(at(0));
    h.commit(at(1));
    const back = h.undo()!;
    expect(h.commit(back)).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    expect(HISTORY_LIMIT).toBe(80);
    const h = new History(at(0));
    for (let i = 1; i <= 85; i++) h.commit(at(i));
    expect(h.depth).toBe(80);
    let last: Composition | null = null;
    let n = 0;
    for (let d = h.undo(); d; d = h.undo()) { last = d; n++; }
    expect(n).toBe(80);
    // the 5 oldest states (0..4) were dropped
    expect(last!.slots[0].cx).toBe(5);
  });

  it('honors a custom limit', () => {
    const h = new History(at(0), 3);
    for (let i = 1; i <= 10; i++) h.commit(at(i));
    expect(h.depth).toBe(3);
  });

  it('snapshots are independent copies', () => {
    const doc = at(0);
    const h = new History(doc);
    doc.slots[0].cx = 1;
    h.commit(doc);
    // mutating the live doc after commit does not touch the saved step
    doc.slots[0].cx = 2;
    doc.frame.shadow.blur = 999;
    const prev = h.undo()!;
    expect(prev.slots[0].cx).toBe(0);
    // mutating a returned snapshot does not touch history
    prev.slots[0].cx = 77;
    prev.background.mesh[0] = '#000000';
    const next = h.redo()!;
    expect(next.slots[0].cx).toBe(1);
    expect(next.frame.shadow.blur).toBe(80);
    const again = h.undo()!;
    expect(again.slots[0].cx).toBe(0);
    expect(again.background.mesh[0]).toBe('#FBEDEA');
    expect(again).not.toBe(prev);
  });

  it('reset forgets all steps', () => {
    const h = new History(at(0));
    h.commit(at(1));
    h.undo();
    h.reset(at(5));
    expect([h.canUndo, h.canRedo]).toEqual([false, false]);
    expect(h.commit(at(5))).toBe(false);
  });
});
