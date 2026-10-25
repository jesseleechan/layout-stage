/* Starting positions for 1–3 images. These are starting points, not fixed layouts: everything stays
   freely draggable. Two families (Composition.arrangement):
   - showcase, the pin looks: 1 = one page, wide, running off the bottom ("Scroll"); 2 = two page
     columns, staggered, or one long page continued from the first column into the second
     ("Columns"); 3 = a hero window in front of two lower ones reaching out to the sides
     ("Editorial"). Pages are shown whole (crop 'full'), so long pages run off the canvas.
   - classic, the prototype's cascades.
   With the headline on at the top or bottom, the layouts start in the part of the canvas it leaves,
   measured with the overlay layout the renderer draws. */
import { applyStyleTo, defaultBackground, sampleSlot, STYLES, clone, type Arrangement, type Composition, type Slot } from './model';
import { cropRatio, unit } from './render/units';
import { defaultOverlays, overlaysOf } from './overlays';
import { layoutOverlays, type Measure } from './render/overlay-layout';
import { canvasMeasure } from './render/overlay-fonts';

type Kind = 'port' | 'sq' | 'land';
type Spot = [fx: number, fy: number, fw: number];
const SPOTS: Record<Kind, Record<1 | 2 | 3, Spot[]>> = {
  port: { 1: [[0.5, 0.5, 0.84]], 2: [[0.4, 0.37, 0.78], [0.6, 0.63, 0.78]], 3: [[0.38, 0.24, 0.72], [0.5, 0.5, 0.72], [0.62, 0.76, 0.72]] },
  sq: { 1: [[0.5, 0.5, 0.8]], 2: [[0.38, 0.38, 0.66], [0.62, 0.62, 0.66]], 3: [[0.5, 0.6, 0.62], [0.3, 0.37, 0.5], [0.7, 0.37, 0.5]] },
  land: { 1: [[0.5, 0.5, 0.7]], 2: [[0.27, 0.5, 0.42], [0.73, 0.5, 0.42]], 3: [[0.5, 0.57, 0.52], [0.24, 0.42, 0.4], [0.76, 0.42, 0.4]] },
};

/* Showcase geometry. Widths and side distances are fractions of the canvas width, tops and drops
   fractions of its height. */

/** Scroll: the page's width (a phone capture's), and its top. */
const SCROLL: Record<Kind, { w: number; phoneW: number; top: number }> = {
  port: { w: 0.8, phoneW: 0.46, top: 0.115 },
  sq: { w: 0.74, phoneW: 0.4, top: 0.11 },
  land: { w: 0.62, phoneW: 0.3, top: 0.11 },
};
/** Columns: side margin and gap; the first column's top, and how much lower the second starts. */
const COLUMNS: Record<Kind, { m: number; g: number; top: number; stagger: number }> = {
  port: { m: 0.1, g: 0.05, top: 0.067, stagger: 0.08 },
  sq: { m: 0.11, g: 0.05, top: 0.1, stagger: 0.09 },
  land: { m: 0.17, g: 0.045, top: 0.1, stagger: 0.1 },
};
/** Editorial: the hero's width and top; the side windows' width, distance from the canvas edge, and
 *  how much lower than the hero they start. */
const EDITORIAL: Record<Kind, { w: number; top: number; sideW: number; side: number; drop: number }> = {
  port: { w: 0.46, top: 0.16, sideW: 0.34, side: 0.05, drop: 0.065 },
  sq: { w: 0.42, top: 0.15, sideW: 0.32, side: 0.06, drop: 0.07 },
  land: { w: 0.38, top: 0.14, sideW: 0.3, side: 0.08, drop: 0.08 },
};

/** Gap between a top or bottom headline's block and the layouts, in units. */
export const HEADLINE_GAP = 40;
/** The layouts keep at least this share of the canvas height: a headline taller than the rest
 *  overlaps them rather than squeezing them to nothing. */
export const MIN_ROOM = 0.25;
/** A group that has to shrink to fit its room fills this much of the room's height (the 1-up cap),
 *  or as much as it filled of the whole canvas when that was more. */
const FILL = 0.86;

export function canvasKind(W: number, H: number): Kind {
  const ar = W / H;
  return ar > 1.1 ? 'land' : ar > 0.9 ? 'sq' : 'port';
}

export const arrangementOf = (doc: Pick<Composition, 'arrangement'>): Arrangement => doc.arrangement ?? 'classic';

/** The crop a page gets in an arrangement: showcase shows pages whole. */
export const showcaseCrop = 'full' as const;

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

function classicSpots(doc: Composition, n: 1 | 2 | 3, room: Room): Placed[] {
  const { W, H } = doc;
  let spots = SPOTS[canvasKind(W, H)][n].map(([fx, fy, fw], i): Placed => {
    let w = fw * W;
    const r = cropRatio(doc.slots[i]);
    const maxH = H * (n === 1 ? 0.86 : n === 2 ? 0.6 : 0.48);
    if (w / r > maxH) w = maxH * r;
    return { cx: fx * W, cy: fy * H, w, h: w / r };
  });
  if (room.t > 0 || room.b < H) spots = intoRoom(spots, room, W, H);
  return spots;
}

const isPhoneCapture = (s: Slot) => s.source.kind === 'url' && s.source.options.width === 390;

/** A layout of width w whose top edge is at `top`. */
const fromTop = (s: Slot, cx: number, top: number, w: number): Placed => {
  const h = w / cropRatio(s);
  return { cx, cy: top + h / 2, w, h };
};

/** Pages one column long continue from the first column into the second: shown whole, the first
 *  column runs off the bottom and the second off the top, so together they read as one page. */
function continues(a: Slot, b: Slot): boolean {
  return a.imageId === b.imageId && a.crop === b.crop && a.crop === showcaseCrop;
}

/** The width of a showcase column on a W × H canvas. */
function columnWidth(W: number, H: number): number {
  const P = COLUMNS[canvasKind(W, H)];
  return (W * (1 - 2 * P.m - P.g)) / 2;
}

/** Whether the second of two showcase columns would continue the first one's page if it showed it:
 *  the page shown whole, longer than the first column's room, and no top headline above them. */
export function canContinuePage(doc: Composition, measure?: Measure | null): boolean {
  if (arrangementOf(doc) !== 'showcase' || doc.count !== 2) return false;
  const a = doc.slots[0];
  if (a.crop !== showcaseCrop) return false;
  const room = layoutRoom(doc, measure);
  const top = Math.max(COLUMNS[canvasKind(doc.W, doc.H)].top * doc.H, room.t);
  return room.t === 0 && columnWidth(doc.W, doc.H) / cropRatio(a) > room.b - top;
}

function showcaseSpots(doc: Composition, n: 1 | 2 | 3, room: Room): Placed[] {
  const { W, H } = doc;
  const kind = canvasKind(W, H);
  const [a, b, c] = doc.slots;
  let spots: Placed[];
  if (n === 1) {
    const P = SCROLL[kind];
    spots = [fromTop(a, W / 2, Math.max(P.top * H, room.t), (isPhoneCapture(a) ? P.phoneW : P.w) * W)];
  } else if (n === 2) {
    const P = COLUMNS[kind];
    const w = columnWidth(W, H);
    const xa = W * P.m + w / 2, xb = W - W * P.m - w / 2;
    const top = Math.max(P.top * H, room.t);
    const ha = w / cropRatio(a);
    if (continues(a, b) && room.t === 0 && ha > room.b - top) {
      // The first column shows the page's first L px (from its top down to the bottom edge), the
      // second the next ones from the canvas top: L is the column's room, or half the page when the
      // page is shorter than two columns (then the columns meet the edges at the same distance).
      const L = Math.min(room.b - top, ha / 2);
      spots = [fromTop(a, xa, room.b - L, w), fromTop(b, xb, -L, w)];
    } else {
      spots = [fromTop(a, xa, top, w), fromTop(b, xb, top + P.stagger * H, w)];
    }
  } else {
    const P = EDITORIAL[kind];
    const top = Math.max(P.top * H, room.t);
    const sw = P.sideW * W;
    spots = [
      fromTop(a, W / 2, top, P.w * W),
      fromTop(b, P.side * W + sw / 2, top + P.drop * H, sw),
      fromTop(c, W - P.side * W - sw / 2, top + P.drop * H, sw),
    ];
  }
  // Pages too short to run off the canvas are centered in the room, scaled down (about the canvas's
  // vertical center line) if they would end behind a bottom headline.
  const top = Math.min(...spots.map((p) => p.cy - p.h / 2));
  const bottom = Math.max(...spots.map((p) => p.cy + p.h / 2));
  if (bottom <= H && top >= 0) {
    const g = bottom - top, space = room.b - room.t;
    const k = Math.min(1, space / g);
    const y = room.t + (space - g * k) / 2;
    spots = spots.map((p) => ({ cx: W / 2 + (p.cx - W / 2) * k, cy: y + (p.cy - top) * k, w: p.w * k, h: p.h * k }));
  }
  return spots;
}

/**
 * Places the first n slots at their starting positions for the composition's arrangement and resets
 * the z-order. Mutates `doc` (positions and order only: crops are the caller's). Given a text measure
 * (pageMeasure() in the app) and the headline on at the top or bottom, the layouts start in the part
 * of the canvas the headline leaves (layoutRoom); otherwise anywhere on the canvas.
 */
export function arrange(doc: Composition, n: 1 | 2 | 3 = doc.count, measure?: Measure | null): void {
  const { W, H } = doc;
  const room = layoutRoom(doc, measure);
  const showcase = arrangementOf(doc) === 'showcase';
  const spots = showcase ? showcaseSpots(doc, n, room) : classicSpots(doc, n, room);
  spots.forEach((p, i) => {
    const s = doc.slots[i];
    s.w = Math.round(p.w);
    s.cx = Math.round(p.cx);
    s.cy = Math.round(p.cy);
  });
  // The editorial 3-up, and the classic one on square and landscape canvases, put the hero (layout 1
  // in showcase, layout 2 in classic) in front of the other two.
  const vis = showcase
    ? n === 3 ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i)
    : canvasKind(W, H) !== 'port' && n === 3 ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i);
  doc.order = [...vis, ...[0, 1, 2].filter((i) => !vis.includes(i))];
}

/** The first-run canvas: a Pinterest pin with two sample sites as showcase columns, in the Blush
 *  mesh style. */
export function defaultComposition(): Composition {
  const doc: Composition = {
    preset: 'pin', W: 1000, H: 1500, count: 2, arrangement: 'showcase',
    slots: [sampleSlot(0), sampleSlot(1), sampleSlot(2)],
    order: [0, 1, 2],
    frame: clone(STYLES[0].frame),
    background: defaultBackground(),
    overlays: defaultOverlays(),
  };
  for (const s of doc.slots) s.crop = showcaseCrop;
  applyStyleTo(doc, STYLES[0]);
  arrange(doc);
  return doc;
}
