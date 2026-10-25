/* Crops and free height. A layout's height is its width over its crop's ratio; besides Full and the
   presets, its height can be set freely (the Height slider, or dragging the layout's bottom edge on
   the canvas), which makes the crop 'custom' with that ratio in `ar`. A free height near Full or a
   preset becomes that crop, so the chips still say what it is. Pure. */
import { CROPS, type CropId, type Slot } from './model';
import { coverSource, cropRatio, scrollAxis, zoomOf } from './render/units';

/** The widest a free height goes, as width / height: a 3:1 band. */
export const MAX_AR = 3;
/** The tallest preset (1:2): a free height always reaches this tall, a long page further, to its whole length. */
export const TALLEST_AR = 0.5;
/** How close (as a fraction of the ratio) a free height snaps to Full or a preset. */
export const SNAP_AR = 0.01;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Sets a crop; a preset or Full drops the free height's ratio. Mutates. */
export function setCropOf(s: Slot, crop: CropId, ar?: number): void {
  s.crop = crop;
  if (crop === 'custom' && ar && ar > 0) s.ar = ar;
  else delete s.ar;
}

/** The heights a layout can take at its width, canvas px: from a 3:1 band to its whole page (at
 *  least as tall as 1:2). */
export function heightRange(s: Pick<Slot, 'w' | 'nw' | 'nh'>): { min: number; max: number } {
  const tallest = Math.min(s.nw / s.nh, TALLEST_AR);
  return { min: s.w / Math.max(MAX_AR, s.nw / s.nh), max: s.w / tallest };
}

/** The crop for a width / height ratio: Full or a preset within SNAP_AR of it, else custom. */
export function cropFor(s: Pick<Slot, 'nw' | 'nh'>, ar: number): { crop: CropId; ar?: number } {
  const near = (r: number) => Math.abs(ar - r) <= r * SNAP_AR;
  if (near(s.nw / s.nh)) return { crop: 'full' };
  const c = CROPS.find((c) => c.ratio && near(c.ratio));
  if (c) return { crop: c.id };
  return { crop: 'custom', ar };
}

/** Gives the layout height `h` (canvas px, within heightRange) at its width. The top edge stays put
 *  and so does the part of the page at the top of the window; a page that can't fill the taller
 *  window shows its bottom. `snapRatio` turns a height near Full or a preset into that crop. Mutates. */
export function setHeight(s: Slot, h: number, snapRatio = true): void {
  const { min, max } = heightRange(s);
  const h1 = clamp(h, min, max);
  const h0 = s.w / cropRatio(s);
  const top = s.cy - h0 / 2;
  const was = coverSource(s.nw, s.nh, s.w, h0, s.fx, s.fy, zoomOf(s));
  const c = snapRatio ? cropFor(s, s.w / h1) : { crop: 'custom' as const, ar: s.w / h1 };
  setCropOf(s, c.crop, c.ar);
  const h2 = s.w / cropRatio(s);
  s.cy = top + h2 / 2;
  if (scrollAxis(s) === 'y') {
    const hidden = s.nh - coverSource(s.nw, s.nh, s.w, h2, s.fx, 0, zoomOf(s)).sh;
    s.fy = hidden > 0 ? Math.round(clamp((was.sy / hidden) * 100, 0, 100) * 100) / 100 : 0;
  }
}
