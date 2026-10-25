/* Drag snapping: the dragged image's center and both edges snap to the canvas center lines, to
   every other visible image's edges and centers and, when the safe-area overlay is shown, to the
   safe area's edges and center lines. */
import type { Composition } from './model';
import { cropRatio, rectOf, type Rect } from './render/units';

export interface SnapResult {
  cx: number;
  cy: number;
  gx: number | null; // vertical guide x (canvas px), when snapped
  gy: number | null; // horizontal guide y
}

/** Snap threshold in canvas px for a 7 screen-px pull at the given zoom. */
export const snapThreshold = (scale: number) => 7 / scale;

/** `safe`: the safe-area rectangle (canvas px) while its overlay is shown, else null. */
export function snap(doc: Composition, i: number, cx: number, cy: number, threshold: number, enabled = true, safe: Rect | null = null): SnapResult {
  let gx: number | null = null, gy: number | null = null;
  if (enabled) {
    const s = doc.slots[i];
    const w = s.w, h = w / cropRatio(s);
    const tx = [doc.W / 2], ty = [doc.H / 2];
    if (safe) {
      tx.push(safe.l, safe.l + safe.w / 2, safe.l + safe.w);
      ty.push(safe.t, safe.t + safe.h / 2, safe.t + safe.h);
    }
    for (let j = 0; j < doc.count; j++) {
      if (j === i) continue;
      const r = rectOf(doc.slots[j]);
      tx.push(r.l + r.w / 2, r.l, r.l + r.w);
      ty.push(r.t + r.h / 2, r.t, r.t + r.h);
    }
    let best = threshold, d = 0;
    for (const a of [0, -w / 2, w / 2]) for (const t of tx) {
      const dd = t - (cx + a);
      if (Math.abs(dd) < best) { best = Math.abs(dd); d = dd; gx = t; }
    }
    if (gx != null) cx += d;
    best = threshold; d = 0;
    for (const a of [0, -h / 2, h / 2]) for (const t of ty) {
      const dd = t - (cy + a);
      if (Math.abs(dd) < best) { best = Math.abs(dd); d = dd; gy = t; }
    }
    if (gy != null) cy += d;
  }
  return { cx, cy, gx, gy };
}
