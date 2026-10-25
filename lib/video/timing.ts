/* Scrolling video: which layout scrolls, the frame size, the H.264 level, and where the page is on
   every frame. A cropped page scrolls inside its frame; a whole page that runs off the bottom of the
   canvas (the showcase arrangements) slides up through it instead. Pure, so the timing is exact and
   testable; lib/video/render.ts draws the frames with the shared renderers in lib/render/. */
import { PRESETS, type Composition, type Slot } from '../model';
import { hiddenSpan, scrollWindow } from '../scroll';
import { rectOf, scrollAxis } from '../render/units';

export const VIDEO_FPS = 30;
export const VIDEO_SECONDS = { min: 6, max: 15, default: 10 };
export const VIDEO_HOLD = { min: 0, max: 2, step: 0.5, default: 1 };
/** Long side of the video in px. */
export const VIDEO_SIZES = [1080, 1440, 1920] as const;
export type VideoLong = (typeof VIDEO_SIZES)[number];
export const VIDEO_LONG_DEFAULT: VideoLong = 1920;

export type VideoEasing = 'smooth' | 'linear' | 'steps';

export interface VideoSettings {
  /** The layout that scrolls; the others stay still. */
  slot: number;
  seconds: number;
  /** Seconds held still at the top and again at the bottom. */
  hold: number;
  easing: VideoEasing;
  long: VideoLong;
}

/* ---------------- which layout ---------------- */

type VideoSlot = Pick<Slot, 'crop' | 'ar' | 'nw' | 'nh' | 'w' | 'fx' | 'fy' | 'cx' | 'cy'>;

/** How far a whole page that runs off the bottom of an H tall canvas slides up, in canvas px: until
 *  its bottom edge is as far from the canvas bottom as its top edge is from the top. 0 for a cropped
 *  page (it scrolls inside its frame), and for one that starts above the canvas or ends on it. */
export function slideSpan(s: VideoSlot, H: number): number {
  if (scrollAxis(s)) return 0;
  const r = rectOf(s as Slot);
  if (r.t < 0 || r.t + r.h <= H) return 0;
  return r.t + r.h - (H - r.t);
}

/** Whether there is something to scroll: a crop that hides part of its page, or (given the canvas
 *  height) a whole page that runs off the bottom of the canvas. */
export function canScroll(s: VideoSlot, H?: number): boolean {
  if (scrollAxis(s) != null) return hiddenSpan(s) >= 1;
  return H != null && slideSpan(s, H) >= 1;
}

/** The visible layouts that can scroll. */
export function scrollableSlots(doc: Pick<Composition, 'slots' | 'count' | 'H'>): number[] {
  return doc.slots.slice(0, doc.count).flatMap((s, i) => (canScroll(s, doc.H) ? [i] : []));
}

/** The selected layout if it can scroll, else the first that can, else null. */
export function defaultScrollSlot(doc: Pick<Composition, 'slots' | 'count' | 'H'>, selected: number | null): number | null {
  const ok = scrollableSlots(doc);
  if (selected != null && ok.includes(selected)) return selected;
  return ok.length ? ok[0] : null;
}

/* ---------------- size ---------------- */

const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));

/** The video's size: the canvas's shape with the long side at `long` px, both sides even (H.264
 *  needs that). m is output px per canvas px. */
export function videoSize(W: number, H: number, long: number): { w: number; h: number; m: number } {
  const m = long / Math.max(W, H);
  return { w: even(W * m), h: even(H * m), m };
}

/* ---------------- encoding ---------------- */

/** H.264 levels: level_idc, max macroblocks per frame and per second (ITU-T H.264 table A-1). */
const AVC_LEVELS: [number, number, number][] = [
  [30, 1620, 40500], [31, 3600, 108000], [32, 5120, 216000], [40, 8192, 245760], [41, 8192, 245760],
  [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600],
];

/** The lowest H.264 levels that fit a w × h stream at fps, lowest first. Empty when none does. */
export function avcLevels(w: number, h: number, fps: number): number[] {
  const mbw = Math.ceil(w / 16), mbh = Math.ceil(h / 16), fs = mbw * mbh;
  return AVC_LEVELS.filter(([, maxFs, maxMbps]) => fs <= maxFs && fs * fps <= maxMbps && Math.max(mbw, mbh) <= Math.sqrt(maxFs * 8)).map(([l]) => l);
}

/** Codec strings to try, best first: High, Main and Constrained Baseline profile at the lowest level
 *  that fits, then one level up (some encoders only take certain levels). */
export function avcCodecs(w: number, h: number, fps: number): string[] {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return avcLevels(w, h, fps).slice(0, 2).flatMap((l) => ['6400', '4D00', '42E0'].map((p) => `avc1.${p}${hex(l)}`));
}

/** Bits per second: screenshots are full of small text, so about 0.16 bits per pixel per frame. */
export function videoBitrate(w: number, h: number, fps: number): number {
  return Math.round(Math.max(4e6, Math.min(24e6, w * h * fps * 0.16)));
}

/** A keyframe every second, so the video seeks quickly. */
export const isKeyFrame = (i: number, fps = VIDEO_FPS) => i % fps === 0;

/* ---------------- timing ---------------- */

export const frameCount = (seconds: number, fps = VIDEO_FPS) => Math.round(seconds * fps);

/** Hold, clamped so the scroll itself takes at least a second. */
export function clampHold(seconds: number, hold: number): number {
  return Math.max(0, Math.min(hold, (seconds - 1) / 2));
}

export const easeInOutSine = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2;
export const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Of each screen-by-screen step, the part spent moving (the rest is a pause). */
const STEP_MOVE = 0.55;
/** Each screen-by-screen step overlaps the last screen by this much, so the eye keeps its place. */
const STEP_OVERLAP = 0.15;
/** Each screen-by-screen step lasts at least this long, in seconds. */
const STEP_MIN_S = 0.7;

/** Screen-by-screen: how many steps for a window showing `size` of the page (0–1) in `scrollS`
 *  seconds of scrolling. */
export function stepCount(size: number, scrollS: number): number {
  if (!(size > 0) || size >= 1) return 1;
  const want = Math.ceil((1 - size) / (size * (1 - STEP_OVERLAP)) - 1e-9);
  return Math.max(1, Math.min(want, Math.floor(scrollS / STEP_MIN_S), 12));
}

/** Progress 0–1 through the scroll → how far down the page, 0–1. */
export function ease(easing: VideoEasing, p: number, steps = 1): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  if (easing === 'linear') return p;
  if (easing === 'steps' && steps > 1) {
    const k = Math.floor(p * steps), local = p * steps - k;
    return (k + easeInOutCubic(Math.min(1, local / STEP_MOVE))) / steps;
  }
  return easing === 'steps' ? easeInOutCubic(p) : easeInOutSine(p);
}

export interface FramePlan {
  frames: number;
  fps: number;
  /** Frames held at the top, and again at the bottom. */
  holdFrames: number;
  easing: VideoEasing;
  steps: number;
}

/** The frames of a video; windowSize is how much of the page the frame shows (0–1, for the steps). */
export function framePlan(settings: Pick<VideoSettings, 'seconds' | 'hold' | 'easing'>, windowSize = 0.5, fps = VIDEO_FPS): FramePlan {
  const frames = frameCount(settings.seconds, fps);
  const hold = clampHold(settings.seconds, settings.hold);
  const holdFrames = Math.round(hold * fps);
  const scrollS = (frames - 1 - 2 * holdFrames) / fps;
  return { frames, fps, holdFrames, easing: settings.easing, steps: settings.easing === 'steps' ? stepCount(windowSize, scrollS) : 1 };
}

/** The scroll position (0–100, CSS object-position %) on frame i: the top through the hold, the
 *  bottom from the last hold on, so the first frame shows the top and the last the bottom. */
export function scrollAtFrame(plan: FramePlan, i: number): number {
  const a = plan.holdFrames, b = plan.frames - 1 - plan.holdFrames;
  const p = b > a ? (i - a) / (b - a) : i >= b ? 1 : 0;
  return 100 * ease(plan.easing, p, plan.steps);
}

/** The frame plan for a slot (screen-by-screen steps depend on how much of the page shows; for a
 *  sliding page, the part on an H tall canvas). */
export function framePlanFor(s: VideoSlot, settings: Pick<VideoSettings, 'seconds' | 'hold' | 'easing'>, fps = VIDEO_FPS, H?: number): FramePlan {
  if (!scrollAxis(s) && H != null && slideSpan(s, H) > 0) {
    const r = rectOf(s as Slot);
    return framePlan(settings, (H - r.t) / r.h, fps);
  }
  return framePlan(settings, scrollWindow(s).size, fps);
}

/** The slot as it is on frame i: fy (Scroll) or fx (Pan) moves, or, for a whole page sliding through
 *  an H tall canvas, its center; nothing else. */
export function slotAtFrame<S extends VideoSlot>(s: S, plan: FramePlan, i: number, H?: number): S {
  const v = scrollAtFrame(plan, i);
  const axis = scrollAxis(s);
  if (!axis && H != null) return { ...s, cy: s.cy - (slideSpan(s, H) * v) / 100 };
  return axis === 'x' ? { ...s, fx: v } : { ...s, fy: v };
}

/* ---------------- file ---------------- */

export function videoFileName(doc: Pick<Composition, 'preset'>, w: number, h: number, ext: 'mp4' | 'webm' = 'mp4'): string {
  return `layout-stage-${PRESETS[doc.preset].slug}-${w}x${h}-scroll.${ext}`;
}
