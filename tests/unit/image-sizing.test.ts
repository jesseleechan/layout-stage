import { describe, expect, it } from 'vitest';
import { downscaleSteps, IOS_CANVAS_MAX_PX, STORE_BUDGET, storedSize, THUMB_BOX, thumbPlan } from '@/lib/image-sizing';

const within = (w: number, h: number, b = STORE_BUDGET) => w <= b.maxW && Math.max(w, h) <= b.maxSide && w * h <= b.maxPx;

describe('storedSize', () => {
  it('keeps images within the budget as they are', () => {
    for (const [w, h] of [[2880, 2560], [1440, 2560], [2880, 11520], [1200, 900], [1, 1], [390, 16383]]) {
      expect(storedSize(w, h)).toEqual({ w, h, scaled: false });
    }
  });

  it('caps the width at 2880 px, proportionally', () => {
    expect(storedSize(6000, 4000)).toEqual({ w: 2880, h: 1920, scaled: true });
    expect(storedSize(5120, 2880)).toEqual({ w: 2880, h: 1620, scaled: true });
    expect(storedSize(4032, 3024)).toEqual({ w: 2880, h: 2160, scaled: true });
  });

  it('caps the area at 2880 × 11,520 (≈ 33.2 MP)', () => {
    const s = storedSize(2880, 16000);
    expect(s.scaled).toBe(true);
    expect(s.w * s.h).toBeLessThanOrEqual(2880 * 11520);
    expect(s.w * s.h).toBeGreaterThan(2880 * 11520 * 0.999);
    expect(s.w / s.h).toBeCloseTo(2880 / 16000, 3);
  });

  it('caps the longest side at 16,383 (WebP and browser limits): the 2880 × 24,000 capture', () => {
    expect(storedSize(2880, 24000)).toEqual({ w: 1965, h: 16383, scaled: true });
    expect(storedSize(780, 24000)).toEqual({ w: 532, h: 16383, scaled: true }); // a phone capture at 2×
    expect(storedSize(40000, 100)).toEqual({ w: 2880, h: 7, scaled: true });
  });

  it('never upscales and always lands within every limit', () => {
    for (let i = 0; i < 400; i++) {
      const w = 1 + Math.floor(((i * 7919) % 9973) * 4.1);
      const h = 1 + Math.floor(((i * 104729) % 30011) * 1.3);
      const s = storedSize(w, h);
      expect(s.w).toBeLessThanOrEqual(w);
      expect(s.h).toBeLessThanOrEqual(h);
      expect(s.w).toBeGreaterThanOrEqual(1);
      expect(s.h).toBeGreaterThanOrEqual(1);
      expect(within(s.w, s.h)).toBe(true);
      expect(s.scaled).toBe(!within(w, h));
    }
  });

  it('fits a smaller budget, e.g. iOS canvases (≤ 4096²)', () => {
    const s = storedSize(2880, 24000, { ...STORE_BUDGET, maxPx: IOS_CANVAS_MAX_PX });
    expect(s.w * s.h).toBeLessThanOrEqual(IOS_CANVAS_MAX_PX);
    expect(s).toEqual({ w: 1418, h: 11824, scaled: true });
  });
});

describe('thumbPlan', () => {
  it('keeps a whole image between 1:2 and 3:2, covering 216 × 144', () => {
    expect(thumbPlan(1440, 2560)).toEqual({ sx: 0, sy: 0, sw: 1440, sh: 2560, w: 216, h: 384 }); // a sample
    expect(thumbPlan(2880, 2560)).toEqual({ sx: 0, sy: 0, sw: 2880, sh: 2560, w: 216, h: 192 });
    expect(thumbPlan(2880, 1920)).toEqual({ sx: 0, sy: 0, sw: 2880, sh: 1920, w: 216, h: 144 });
    expect(thumbPlan(1000, 1000)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000, w: 216, h: 216 });
  });

  it('crops a tall image from the top (like the row thumb’s object-position 50% 0) to 1:2', () => {
    expect(thumbPlan(1965, 16383)).toEqual({ sx: 0, sy: 0, sw: 1965, sh: 3930, w: 216, h: 432 });
  });

  it('crops a wide image at the center (like object-fit: cover) to 3:2', () => {
    const t = thumbPlan(3000, 1000);
    expect(t).toEqual({ sx: 750, sy: 0, sw: 1500, sh: 1000, w: 216, h: 144 });
  });

  it('covers both panel thumbs at 2× DPR and never upscales', () => {
    for (const [w, h] of [[2880, 24000], [390, 844], [2880, 900], [1200, 900], [640, 480], [100, 50], [30, 400]]) {
      const t = thumbPlan(w, h);
      expect(t.w).toBeLessThanOrEqual(Math.ceil(t.sw));
      expect(t.h).toBeLessThanOrEqual(Math.ceil(t.sh));
      if (t.sw >= THUMB_BOX.w && t.sh >= THUMB_BOX.h) {
        // cover: the 54 × 36 row and 64 × 48 background thumbs at 2×
        expect(Math.min(t.w / 108, t.h / 72)).toBeGreaterThanOrEqual(1);
        expect(Math.min(t.w / 128, t.h / 96)).toBeGreaterThanOrEqual(1);
      }
      expect(t.w / t.h).toBeLessThanOrEqual(1.5 + 0.02);
      expect(t.w / t.h).toBeGreaterThanOrEqual(0.5 - 0.02);
    }
  });
});

describe('downscaleSteps', () => {
  it('draws once when the scale is 0.5 or more', () => {
    expect(downscaleSteps(2880, 24000, 1965, 16383)).toEqual([{ w: 1965, h: 16383 }]);
    expect(downscaleSteps(2000, 1000, 1000, 500)).toEqual([{ w: 1000, h: 500 }]);
    expect(downscaleSteps(100, 100, 100, 100)).toEqual([{ w: 100, h: 100 }]);
  });

  it('halves until one more halving would pass the target', () => {
    expect(downscaleSteps(6000, 4000, 2880, 1920)).toEqual([{ w: 3000, h: 2000 }, { w: 2880, h: 1920 }]);
    expect(downscaleSteps(4000, 4000, 1000, 1000)).toEqual([{ w: 2000, h: 2000 }, { w: 1000, h: 1000 }]);
    expect(downscaleSteps(1965, 3930, 216, 432)).toEqual([
      { w: 983, h: 1965 }, { w: 491, h: 983 }, { w: 246, h: 491 }, { w: 216, h: 432 },
    ]);
  });

  it('every draw scales by at least 0.5 and the last is the target', () => {
    for (const [sw, sh, tw, th] of [[9000, 6000, 216, 144], [2880, 5760, 216, 432], [5000, 300, 2880, 173], [3000, 2000, 2880, 1920]]) {
      const steps = downscaleSteps(sw, sh, tw, th);
      expect(steps[steps.length - 1]).toEqual({ w: tw, h: th });
      let w = sw;
      for (const s of steps) {
        expect(s.w / w).toBeGreaterThanOrEqual(0.5 - 1e-3);
        expect(s.w).toBeLessThan(w + 1);
        w = s.w;
      }
    }
  });

  it('skips intermediates over maxPx (iOS: the 2880 × 24,000 capture at 1418 × 11,824)', () => {
    expect(downscaleSteps(2880, 24000, 1418, 11824)).toEqual([{ w: 1440, h: 12000 }, { w: 1418, h: 11824 }]);
    expect(downscaleSteps(2880, 24000, 1418, 11824, IOS_CANVAS_MAX_PX)).toEqual([{ w: 1418, h: 11824 }]);
  });
});
