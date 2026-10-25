/* Starting positions for 1–3 images. These are starting points, not preset layouts:
   everything stays freely draggable. With the headline on at the top or bottom, the layouts start in
   the part of the canvas it leaves, measured with the overlay layout the renderer draws. */
import { applyStyleTo, defaultBackground, sampleSlot, STYLES, clone, type Composition } from './model';
import { cropRatio, unit } from './render/units';
import { defaultOverlays, overlaysOf } from './overlays';
import { layoutOverlays, type Measure } from './render/overlay-layout';
import { canvasMeasure } from './render/overlay-fonts';

type Spot = [fx: number, fy: number, fw: number];
const SPOTS: Record<'port' | 'sq' | 'land', Record<1 | 2 | 3, Spot[]>> = {
  port: { 1: [[0.5, 0.5, 0.84]], 2: [[0.4, 0.37, 0.78], [0.6, 0.63, 0.78]], 3: [[0.38, 0.24, 0.72], [0.5, 0.5, 0.72], [0.62, 0.76, 0.72]] },
  sq: { 1: [[0.5, 0.5, 0.8]], 2: [[0.38, 0.38, 0.66], [0.62, 0.62, 0.66]], 3: [[0.5, 0.6, 0.62], [0.3, 0.37, 0.5], [0.7, 0.37, 0.5]] },
  land: { 1: [[0.5, 0.5, 0.7]], 2: [[0.27, 0.5, 0.42], [0.73, 0.5, 0.42]], 3: [[0.5, 0.57, 0.52], [0.24, 0.42, 0.4], [0.76, 0.42, 0.4]] },
};

/** Gap between a top or bottom headline's block and the layouts, in units. */
export const HEADLINE_GAP = 40;
/** The layouts keep at least this share of the canvas height: a headline taller than the rest
 *  overlaps them rather than squeezing them to nothing. */
export const MIN_ROOM = 0.25;
/** A group that has to shrink to fit its room fills this much of the room's height (the 1-up cap),
 *  or as much as it filled of the whole canvas when that was more. */
const FILL = 0.86;

export function canvasKind(W: number, H: number): 'port' | 'sq' | 'land' {
  const ar = W / H;
  return ar > 1.1 ? 'land' : ar > 0.9 ? 'sq' : 'port';
}

/** The text measure the app arranges with: the canvas's in a browser; none elsewhere (the server,
 *  unit tests), where the headline gets no room. The overlay fonts are in by then: the preview loads
 *  them as soon as the headline is on. */
export const pageMeasure = (): Measure | null => (typeof document === 'undefined' ? null : canvasMeasure);

export interface Room {
  t: number; // canvas px
  b: number;
}

/** The band the layouts start in: the whole height; or, with the headline on at the top or bottom,
 *  the rest of the canvas beyond its block (laid out as it's drawn, offsets included, its text
 *  measured with `measure`) and HEADLINE_GAP. Without a measure: the whole height. */
export function layoutRoom(doc: Composition, measure?: Measure | null): Room {
  const { W, H } = doc;
  const h = overlaysOf(doc).headline;
  if (!measure || !h.enabled || h.place === 'middle') return { t: 0, b: H };
  const box = layoutOverlays(doc, measure).headline?.box;
  if (!box) return { t: 0, b: H };
  const gap = HEADLINE_GAP * unit(W, H);
  return h.place === 'top'
    ? { t: Math.max(0, Math.min(box.t + box.h + gap, H * (1 - MIN_ROOM))), b: H }
    : { t: 0, b: Math.min(H, Math.max(box.t - gap, H * MIN_ROOM)) };
}

interface Placed {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** The arrangement moved into the band: the same layouts in the same proportions, scaled down (about
 *  the canvas's vertical center line) only when the group doesn't fit, with the space left over
 *  shared above and below it as it was on the whole canvas. */
function intoRoom(spots: Placed[], { t, b }: Room, W: number, H: number): Placed[] {
  const top = Math.min(...spots.map((p) => p.cy - p.h / 2));
  const bottom = Math.max(...spots.map((p) => p.cy + p.h / 2));
  const g = bottom - top, room = b - t;
  const k = Math.min(1, (room * Math.min(1, Math.max(FILL, g / H))) / g);
  const above = Math.max(0, top), below = Math.max(0, H - bottom);
  const y = t + (room - g * k) * (above + below > 0 ? above / (above + below) : 0.5);
  return spots.map((p) => ({ cx: W / 2 + (p.cx - W / 2) * k, cy: y + (p.cy - top) * k, w: p.w * k, h: p.h * k }));
}

/**
 * Places the first n slots at their starting positions and resets the z-order. Mutates `doc`. Given a
 * text measure (pageMeasure() in the app) and the headline on at the top or bottom, the layouts start
 * in the part of the canvas the headline leaves (layoutRoom); otherwise anywhere on the canvas.
 */
export function arrange(doc: Composition, n: 1 | 2 | 3 = doc.count, measure?: Measure | null): void {
  const { W, H } = doc;
  const kind = canvasKind(W, H);
  let spots = SPOTS[kind][n].map(([fx, fy, fw], i): Placed => {
    let w = fw * W;
    const r = cropRatio(doc.slots[i]);
    const maxH = H * (n === 1 ? 0.86 : n === 2 ? 0.6 : 0.48);
    if (w / r > maxH) w = maxH * r;
    return { cx: fx * W, cy: fy * H, w, h: w / r };
  });
  const room = layoutRoom(doc, measure);
  if (room.t > 0 || room.b < H) spots = intoRoom(spots, room, W, H);
  spots.forEach((p, i) => {
    const s = doc.slots[i];
    s.w = Math.round(p.w);
    s.cx = Math.round(p.cx);
    s.cy = Math.round(p.cy);
  });
  // On square and landscape canvases the 3-up is a hero with two behind it.
  const vis = kind !== 'port' && n === 3 ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i);
  doc.order = [...vis, ...[0, 1, 2].filter((i) => !vis.includes(i))];
}

/** The first-run canvas: a Pinterest pin with two sample sites in the Blush mesh style. */
export function defaultComposition(): Composition {
  const doc: Composition = {
    preset: 'pin', W: 1000, H: 1500, count: 2,
    slots: [sampleSlot(0), sampleSlot(1), sampleSlot(2)],
    order: [0, 1, 2],
    frame: clone(STYLES[0].frame),
    background: defaultBackground(),
    overlays: defaultOverlays(),
  };
  applyStyleTo(doc, STYLES[0]);
  arrange(doc);
  return doc;
}
