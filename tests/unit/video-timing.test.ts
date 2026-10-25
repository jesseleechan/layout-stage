/* Scrolling video timing and sizing (lib/video/timing.ts): exact frame counts, the first frame at the
   top and the last at the bottom, holds, easings, even sizes and the H.264 level. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { clone, sampleSlot, type Slot } from '@/lib/model';
import { rectOf } from '@/lib/render/units';
import {
  avcCodecs, avcLevels, canScroll, clampHold, defaultScrollSlot, ease, framePlan, framePlanFor, frameCount, isKeyFrame,
  scrollableSlots, scrollAtFrame, slideSpan, slotAtFrame, stepCount, VIDEO_FPS, VIDEO_SIZES, videoBitrate, videoFileName, videoSize,
  type VideoEasing,
} from '@/lib/video/timing';
import { classicComposition } from './helpers';

const EASINGS: VideoEasing[] = ['smooth', 'linear', 'steps'];
const positions = (plan: ReturnType<typeof framePlan>) => Array.from({ length: plan.frames }, (_, i) => scrollAtFrame(plan, i));

describe('frame plan', () => {
  it('has exactly seconds × 30 frames', () => {
    for (const s of [6, 10, 15]) expect(framePlan({ seconds: s, hold: 1, easing: 'smooth' }).frames).toBe(s * VIDEO_FPS);
    expect(frameCount(7.5)).toBe(225);
  });

  it('starts at the top, ends at the bottom and never moves back', () => {
    for (const easing of EASINGS) {
      for (const hold of [0, 0.5, 1, 2]) {
        const plan = framePlan({ seconds: 10, hold, easing }, 0.3);
        const p = positions(plan);
        expect(p[0]).toBe(0);
        expect(p[p.length - 1]).toBe(100);
        for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1] - 1e-9);
        p.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
      }
    }
  });

  it('holds still for the pause at the top and at the bottom', () => {
    const plan = framePlan({ seconds: 10, hold: 1, easing: 'smooth' });
    expect(plan.holdFrames).toBe(30);
    const p = positions(plan);
    expect(p.slice(0, 31).every((v) => v === 0)).toBe(true); // frames 0–30: the top
    expect(p[31]).toBeGreaterThan(0);
    expect(p.slice(-31).every((v) => v === 100)).toBe(true); // the last 31 frames: the bottom
    expect(p[p.length - 32]).toBeLessThan(100);
  });

  it('keeps at least a second of scrolling', () => {
    expect(clampHold(6, 2)).toBe(2);
    expect(clampHold(3, 2)).toBe(1);
    expect(clampHold(10, -1)).toBe(0);
  });

  it('eases: smooth is symmetric and slow at the ends, linear is even', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('smooth', 0.5)).toBeCloseTo(0.5, 12);
    expect(ease('smooth', 0.1) + ease('smooth', 0.9)).toBeCloseTo(1, 12);
    expect(ease('smooth', 0.05)).toBeLessThan(0.05);
    expect(ease('smooth', -1)).toBe(0);
    expect(ease('smooth', 2)).toBe(1);
  });

  it('screen by screen: moves, pauses, moves again', () => {
    expect(stepCount(1, 8)).toBe(1);
    expect(stepCount(0.35, 8)).toBe(3); // (1 − 0.35) / (0.35 × 0.85) ≈ 2.2 → 3 screens
    expect(stepCount(0.05, 8)).toBe(11); // capped by a 0.7 s minimum per step
    expect(stepCount(0.01, 100)).toBe(12);
    const steps = 3;
    // Each step ends on a whole screen and holds there before the next.
    expect(ease('steps', 1 / 3, steps)).toBeCloseTo(1 / 3, 12);
    expect(ease('steps', 0.3, steps)).toBeCloseTo(1 / 3, 12); // pausing at the end of step 1
    expect(ease('steps', 0.1, steps)).toBeLessThan(1 / 3); // still moving
    expect(ease('steps', 0.6, steps)).toBeCloseTo(2 / 3, 12);
    const plan = framePlan({ seconds: 10, hold: 1, easing: 'steps' }, 0.35);
    expect(plan.steps).toBe(3);
    const p = positions(plan);
    const plateaus = p.filter((v, i) => i > 0 && v === p[i - 1] && v > 0 && v < 100);
    expect(plateaus.length).toBeGreaterThan(20);
  });

  it('works without a pause', () => {
    const plan = framePlan({ seconds: 6, hold: 0, easing: 'linear' });
    const p = positions(plan);
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(100 / 179, 9);
    expect(p[179]).toBe(100);
  });

  it('a keyframe every second', () => {
    const keys = Array.from({ length: 300 }, (_, i) => i).filter((i) => isKeyFrame(i));
    expect(keys).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270]);
  });
});

describe('which layout scrolls', () => {
  const doc = () => {
    const d = classicComposition();
    d.count = 3;
    return d;
  };

  it('only layouts whose crop hides part of the page', () => {
    const d = doc();
    d.slots[0].crop = 'full';
    expect(canScroll(d.slots[0])).toBe(false);
    expect(canScroll(d.slots[1])).toBe(true);
    expect(scrollableSlots(d)).toEqual([1, 2]);
  });

  it('the selected layout when it can scroll, else the first that can, else none', () => {
    const d = doc();
    expect(defaultScrollSlot(d, 2)).toBe(2);
    expect(defaultScrollSlot(d, null)).toBe(0);
    d.slots[0].crop = 'full';
    expect(defaultScrollSlot(d, 0)).toBe(1);
    // Whole pages that stay on the canvas: nothing to scroll.
    d.slots.forEach((s) => { s.crop = 'full'; s.w = 300; s.cy = 750; });
    expect(defaultScrollSlot(d, 1)).toBeNull();
    const two = classicComposition(); // layout 3 is hidden
    expect(defaultScrollSlot(two, 2)).toBe(0);
  });

  it('moves fy for Scroll and fx for Pan, nothing else', () => {
    const tall = sampleSlot(0); // 1440 × 2560 in 16:10: scrolls
    const plan = framePlanFor(tall, { seconds: 6, hold: 0, easing: 'linear' });
    const mid = slotAtFrame(tall, plan, 90);
    expect(mid.fy).toBeCloseTo((100 * 90) / 179, 9);
    expect({ ...mid, fy: tall.fy }).toEqual(tall);
    const wide: Slot = { ...clone(tall), nw: 4000, nh: 1000, crop: '1:1', fx: 30 };
    const last = slotAtFrame(wide, plan, 179);
    expect([last.fx, last.fy]).toEqual([100, wide.fy]);
  });
});

describe('whole pages running off the canvas slide', () => {
  /** A 1440 × 7680 page shown whole, 800 wide (4267 tall), its top 172 px down a 1500 tall pin. */
  const long = (): Slot => ({ ...sampleSlot(0), nh: 7680, crop: 'full', w: 800, cx: 500, cy: 172 + 4266.67 / 2 });

  it('slides until its bottom edge is as far from the canvas bottom as its top was from the top', () => {
    const s = long();
    const r = rectOf(s);
    expect(slideSpan(s, 1500)).toBeCloseTo(r.t + r.h - (1500 - r.t), 6);
    expect(canScroll(s)).toBe(false); // without the canvas height there's no telling
    expect(canScroll(s, 1500)).toBe(true);
  });

  it('a cropped page, one on the canvas, or one starting above it never slides', () => {
    expect(slideSpan({ ...long(), crop: '16:10' }, 1500)).toBe(0);
    expect(slideSpan({ ...long(), w: 200, cy: 750 }, 1500)).toBe(0);
    expect(slideSpan({ ...long(), cy: -100 }, 1500)).toBe(0);
  });

  it('moves the center from the start to the end, nothing else; steps follow the part on the canvas', () => {
    const s = long();
    const plan = framePlanFor(s, { seconds: 6, hold: 0, easing: 'linear' }, 30, 1500);
    const first = slotAtFrame(s, plan, 0, 1500);
    const last = slotAtFrame(s, plan, plan.frames - 1, 1500);
    expect(first).toEqual(s);
    expect(last.cy).toBeCloseTo(s.cy - slideSpan(s, 1500), 6);
    expect({ ...last, cy: s.cy }).toEqual(s);
    const r = rectOf(last);
    expect(1500 - (r.t + r.h)).toBeCloseTo(rectOf(s).t, 6);
    const steps = framePlanFor(s, { seconds: 10, hold: 0, easing: 'steps' }, 30, 1500).steps;
    expect(steps).toBeGreaterThan(1);
  });

  it('counts among the layouts that can scroll', () => {
    const d = defaultComposition();
    d.count = 1;
    d.slots[0] = long();
    expect(scrollableSlots(d)).toEqual([0]);
    expect(defaultScrollSlot(d, null)).toBe(0);
  });
});

describe('size and encoding', () => {
  it('keeps the canvas shape, the long side as asked, both sides even', () => {
    expect(videoSize(1000, 1500, 1920)).toMatchObject({ w: 1280, h: 1920 });
    expect(videoSize(3000, 2250, 1920)).toMatchObject({ w: 1920, h: 1440 });
    expect(videoSize(2000, 2000, 1080)).toMatchObject({ w: 1080, h: 1080 });
    expect(videoSize(1080, 1350, 1920)).toMatchObject({ w: 1536, h: 1920 });
    for (const long of VIDEO_SIZES) {
      for (const [W, H] of [[1000, 1500], [1234, 777], [201, 5999], [6000, 6000]]) {
        const s = videoSize(W, H, long);
        expect(s.w % 2).toBe(0);
        expect(s.h % 2).toBe(0);
        expect(Math.max(s.w, s.h)).toBe(long);
        expect(Math.abs(s.w / s.h - W / H)).toBeLessThan(0.02);
      }
    }
  });

  it('picks the lowest H.264 level that fits the frame size and rate', () => {
    expect(avcLevels(720, 1080, 30)[0]).toBe(31);
    expect(avcLevels(1280, 720, 30)[0]).toBe(31);
    expect(avcLevels(1920, 1080, 30)[0]).toBe(40);
    expect(avcLevels(1280, 1920, 30)[0]).toBe(50); // 9600 macroblocks: over level 4.2's 8704
    expect(avcLevels(1920, 1920, 30)[0]).toBe(50);
    expect(avcCodecs(1280, 1920, 30)).toEqual(['avc1.640032', 'avc1.4D0032', 'avc1.42E032', 'avc1.640033', 'avc1.4D0033', 'avc1.42E033']);
  });

  it('a bitrate that grows with the frame, within limits', () => {
    expect(videoBitrate(720, 1080, 30)).toBe(4e6);
    expect(videoBitrate(1280, 1920, 30)).toBeGreaterThan(videoBitrate(960, 1440, 30));
    expect(videoBitrate(8000, 8000, 30)).toBe(24e6);
  });

  it('names the file after the canvas and size', () => {
    expect(videoFileName({ preset: 'pin' }, 1280, 1920)).toBe('layout-stage-pinterest-1280x1920-scroll.mp4');
    expect(videoFileName({ preset: 'etsy43' }, 1920, 1440, 'webm')).toBe('layout-stage-etsy-4x3-1920x1440-scroll.webm');
  });
});
