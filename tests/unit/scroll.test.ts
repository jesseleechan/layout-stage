import { describe, expect, it } from 'vitest';
import { sampleSlot, type Slot } from '@/lib/model';
import { coverSource, rectOf } from '@/lib/render/units';
import { hiddenSpan, miniMapSize, scrollAfterMove, scrollForWindow, scrollValue, scrollWindow } from '@/lib/scroll';

/** A 1440 × 2560 sample at 16:10, 800 px wide: the frame is 800 × 500 and the image is drawn
 *  800 × 1422.2 px, so 922.2 canvas px are hidden (vertical Scroll). */
const tall = (p: Partial<Slot> = {}): Slot => ({ ...sampleSlot(0), crop: '16:10', w: 800, fx: 50, fy: 0, ...p });
/** A 3000 × 1000 image at 1:1, 400 px wide: drawn 1200 × 400, so 800 px are hidden (horizontal Pan). */
const wide = (p: Partial<Slot> = {}): Slot => ({ ...sampleSlot(0), nw: 3000, nh: 1000, crop: '1:1', w: 400, fx: 0, fy: 0, ...p });

describe('scrollValue / hiddenSpan', () => {
  it('reads fy for Scroll, fx for Pan, null when the crop shows the whole image', () => {
    expect(scrollValue(tall({ fy: 30 }))).toBe(30);
    expect(scrollValue(wide({ fx: 70 }))).toBe(70);
    expect(scrollValue(tall({ crop: 'full' }))).toBeNull();
  });

  it('is the hidden part of the drawn image in canvas px', () => {
    expect(hiddenSpan(tall())).toBeCloseTo(800 * (2560 / 1440) - 500, 6);
    expect(hiddenSpan(wide())).toBeCloseTo(800, 6);
    expect(hiddenSpan(tall({ crop: 'full' }))).toBe(0);
  });

  it('does not depend on the current scroll position', () => {
    expect(hiddenSpan(tall({ fy: 0 }))).toBeCloseTo(hiddenSpan(tall({ fy: 100 })), 9);
  });
});

describe('scrollAfterMove', () => {
  it('follows the pointer: moving the image up reveals lower content', () => {
    const s = tall();
    const span = hiddenSpan(s);
    expect(scrollAfterMove(s, 0, -span / 2)).toBe(50);
    expect(scrollAfterMove(s, 50, span / 4)).toBe(25);
    expect(scrollAfterMove(wide(), 0, -200)).toBe(25); // dragging left reveals the right side
  });

  it('moves the drawn image by exactly the pointer distance', () => {
    const s = tall({ fy: 20 });
    const before = coverSource(s.nw, s.nh, 800, 500, s.fx, s.fy);
    const after = coverSource(s.nw, s.nh, 800, 500, s.fx, scrollAfterMove(s, s.fy, -100));
    const k = 800 / 1440; // canvas px per image px
    expect((after.sy - before.sy) * k).toBeCloseTo(100, 0);
  });

  it('clamps to 0–100 and rounds to 0.01 %', () => {
    const s = tall();
    expect(scrollAfterMove(s, 90, -10_000)).toBe(100);
    expect(scrollAfterMove(s, 10, 10_000)).toBe(0);
    const v = scrollAfterMove(s, 0, -1);
    expect(Math.round(v * 100) / 100).toBe(v);
  });

  it('leaves a layout without hidden content alone', () => {
    expect(scrollAfterMove(tall({ crop: 'full' }), 0, -50)).toBe(0);
  });
});

describe('scrollWindow / scrollForWindow', () => {
  it('is the visible fraction of the image and where it starts', () => {
    // 16:10 of a 9:16 image: 0.5625 / 1.6 of its height is visible.
    const size = 0.5625 / 1.6;
    expect(scrollWindow(tall({ fy: 0 }))).toEqual({ start: 0, size: expect.closeTo(size, 9) });
    expect(scrollWindow(tall({ fy: 100 })).start).toBeCloseTo(1 - size, 9);
    expect(scrollWindow(tall({ fy: 50 })).start).toBeCloseTo((1 - size) / 2, 9);
    expect(scrollWindow(wide({ fx: 100 }))).toEqual({ start: expect.closeTo(2 / 3, 9), size: expect.closeTo(1 / 3, 9) });
    expect(scrollWindow(tall({ crop: 'full' }))).toEqual({ start: 0, size: 1 });
  });

  it('round-trips with scrollWindow', () => {
    for (const fy of [0, 12.5, 50, 87.25, 100]) {
      const s = tall({ fy });
      expect(scrollForWindow(s, scrollWindow(s).start)).toBeCloseTo(fy, 2);
    }
    expect(scrollForWindow(wide(), 1 / 3)).toBe(50);
  });

  it('clamps a window pushed past either end', () => {
    expect(scrollForWindow(tall(), -0.3)).toBe(0);
    expect(scrollForWindow(tall(), 0.95)).toBe(100);
    expect(scrollForWindow(tall({ crop: 'full' }), 0.5)).toBe(0);
  });

  it('matches the rect the preview draws (frame size from rectOf)', () => {
    const s = tall({ fy: 40 });
    const r = rectOf(s);
    const src = coverSource(s.nw, s.nh, r.w, r.h, s.fx, s.fy);
    expect(scrollWindow(s).start).toBeCloseTo(src.sy / s.nh, 12);
  });
});

describe('miniMapSize', () => {
  it('keeps the aspect ratio for ordinary pages', () => {
    expect(miniMapSize(1440, 2560, 'y')).toEqual({ w: 84, h: 150 });
    expect(miniMapSize(3000, 1000, 'x')).toEqual({ w: 240, h: 80 });
  });

  it('fits the cross side and keeps a usable minimum for very long pages', () => {
    expect(miniMapSize(1440, 1600, 'y')).toEqual({ w: 120, h: 133 });
    expect(miniMapSize(1440, 20000, 'y')).toEqual({ w: 28, h: 150 });
    expect(miniMapSize(1000, 1500, 'x')).toEqual({ w: 73, h: 110 });
    expect(miniMapSize(20000, 1000, 'x')).toEqual({ w: 240, h: 28 });
  });
});
