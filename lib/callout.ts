/* Zoom callouts: a magnified card of part of a page, floating over the layout it comes from (a
   common look for template mockups). A callout is an ordinary layout with a zoom (Slot.zoom, which
   coverSource applies for the preview and the export alike), so it moves, resizes, crops and scrolls
   like any other. Pure. */
import { clone, type Composition } from './model';
import { setCropOf } from './crop';
import { coverSource, rectOf, zoomOf } from './render/units';

/** How much bigger the callout shows the page than the layout it comes from. */
export const CALLOUT_MAGNIFY = 2;
/** The callout's width, as a fraction of the canvas's short side. */
const CALLOUT_WIDTH = 0.42;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Makes layout j a callout of layout i: the same page, at 4:3, CALLOUT_MAGNIFY times bigger than
 *  layout i shows it, centered on the middle of what layout i shows on the canvas, overlapping its
 *  lower right and on top of everything. Layout j becomes visible. Mutates. */
export function addCallout(d: Composition, i: number, j: number): void {
  const src = d.slots[i];
  const r = rectOf(src);
  const c = coverSource(src.nw, src.nh, r.w, r.h, src.fx, src.fy, zoomOf(src));
  // The middle of the part of layout i that's on the canvas, as a point on its page.
  const vl = clamp(r.l, 0, d.W), vr = clamp(r.l + r.w, 0, d.W), vt = clamp(r.t, 0, d.H), vb = clamp(r.t + r.h, 0, d.H);
  const mx = vr > vl ? (vl + vr) / 2 : r.l + r.w / 2, my = vb > vt ? (vt + vb) / 2 : r.t + r.h / 2;
  const px = c.sx + ((mx - r.l) / r.w) * c.sw, py = c.sy + ((my - r.t) / r.h) * c.sh;

  const s = d.slots[j];
  Object.assign(s, { imageId: src.imageId, name: src.name, source: clone(src.source), nw: src.nw, nh: src.nh });
  setCropOf(s, '4:3');
  const short = Math.min(d.W, d.H);
  s.w = Math.round(short * CALLOUT_WIDTH);
  const h = s.w / (4 / 3);
  // Page px per canvas px in layout i, over that in the callout at zoom 1: the zoom that magnifies.
  const base = coverSource(s.nw, s.nh, s.w, h, 50, 0);
  const z = clamp((CALLOUT_MAGNIFY * (base.sw / s.w)) / (c.sw / r.w), 1.1, 4);
  s.zoom = Math.round(z * 100) / 100;
  const win = coverSource(s.nw, s.nh, s.w, h, 0, 0, s.zoom);
  s.fx = s.nw > win.sw ? Math.round(clamp(((px - win.sw / 2) / (s.nw - win.sw)) * 100, 0, 100) * 100) / 100 : 50;
  s.fy = s.nh > win.sh ? Math.round(clamp(((py - win.sh / 2) / (s.nh - win.sh)) * 100, 0, 100) * 100) / 100 : 0;
  const m = short * 0.05;
  s.cx = Math.round(clamp(Math.min(r.l + r.w * 0.85, vr || d.W), s.w / 2 + m, d.W - s.w / 2 - m));
  s.cy = Math.round(clamp(my + h * 0.35, h / 2 + m, d.H - h / 2 - m));
  d.count = Math.max(d.count, j + 1) as 1 | 2 | 3;
  d.order = [...d.order.filter((k) => k !== j), j];
}
