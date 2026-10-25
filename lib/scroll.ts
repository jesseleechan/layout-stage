/* Scrolling a cropped image inside its frame: Scroll moves fy, Pan moves fx (CSS object-position %,
   0 = the top / left of the image shows, 100 = the bottom / right). Every figure here comes from
   coverSource(), the cover crop the preview and the export both draw with, so the canvas gestures and
   the mini-map move exactly what is rendered. Pure. */
import type { Slot } from './model';
import { coverSource, cropRatio, scrollAxis } from './render/units';

/** What the scroll math reads from a slot. */
export type ScrollSlot = Pick<Slot, 'crop' | 'ar' | 'nw' | 'nh' | 'w' | 'fx' | 'fy'>;

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The cover-crop source rect at the slot's current size and position. */
const source = (s: ScrollSlot) => coverSource(s.nw, s.nh, s.w, s.w / cropRatio(s), s.fx, s.fy);

/** The scroll position along the slot's axis (fy for Scroll, fx for Pan), or null when the crop
 *  shows the whole image. */
export function scrollValue(s: ScrollSlot): number | null {
  const axis = scrollAxis(s);
  return axis === 'y' ? s.fy : axis === 'x' ? s.fx : null;
}

/** Canvas px of the image hidden along the scroll axis at the slot's current size; 0 when none. */
export function hiddenSpan(s: ScrollSlot): number {
  const axis = scrollAxis(s);
  if (!axis) return 0;
  const src = source(s);
  const k = s.w / src.sw; // canvas px per image px
  return axis === 'y' ? (s.nh - src.sh) * k : (s.nw - src.sw) * k;
}

/** The scroll value after the image moves `d` canvas px along its axis, starting from `from`.
 *  The image follows the pointer: moving it up (d < 0) reveals lower content. Clamped to 0–100 and
 *  rounded to 0.01 %. */
export function scrollAfterMove(s: ScrollSlot, from: number, d: number): number {
  const span = hiddenSpan(s);
  if (!(span > 0)) return from;
  return round2(clampPct(from - (d / span) * 100));
}

/** The visible part of the image along the scroll axis, as fractions of the image (0–1). */
export function scrollWindow(s: ScrollSlot): { start: number; size: number } {
  const axis = scrollAxis(s);
  if (!axis) return { start: 0, size: 1 };
  const src = source(s);
  return axis === 'y' ? { start: src.sy / s.nh, size: src.sh / s.nh } : { start: src.sx / s.nw, size: src.sw / s.nw };
}

/** The scroll value that starts the visible window at `start` (a fraction of the image). Clamped to
 *  0–100 and rounded to 0.01 %. */
export function scrollForWindow(s: ScrollSlot, start: number): number {
  const { size } = scrollWindow(s);
  if (size >= 1) return 0;
  return round2(clampPct((start / (1 - size)) * 100));
}

/** Mini-map strip size in screen px: the whole image, long along the scroll axis. Keeps the image's
 *  aspect ratio unless it is extremely long, where the strip keeps a usable minimum width. */
export function miniMapSize(nw: number, nh: number, axis: 'x' | 'y'): { w: number; h: number } {
  const nr = nw / nh;
  const LONG = axis === 'y' ? 150 : 240, CROSS_MAX = axis === 'y' ? 120 : 110, CROSS_MIN = 28;
  if (axis === 'y') {
    let h = LONG, w = h * nr;
    if (w > CROSS_MAX) { w = CROSS_MAX; h = w / nr; }
    return { w: Math.round(Math.max(CROSS_MIN, w)), h: Math.round(h) };
  }
  let w = LONG, h = w / nr;
  if (h > CROSS_MAX) { h = CROSS_MAX; w = h * nr; }
  return { w: Math.round(w), h: Math.round(Math.max(CROSS_MIN, h)) };
}
