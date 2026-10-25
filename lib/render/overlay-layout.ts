/* Where the headline, badge and watermark go, in canvas px. Pure: a function of the composition and a
   text measure only, never of the output scale, so the preview (any zoom) and the export (1×, 2×)
   wrap, fit and place text identically; lib/render/overlays.ts then draws this layout at k output px
   per canvas px. Text is measured once at REF_PX and scaled linearly. */
import { PRESETS, type Composition } from '../model';
import { OVERLAY_FONTS, fontCss, overlaysOf, resolveFace, type BadgeShape, type OverlayAlign, type OverlayCorner, type OverlayFace, type WatermarkPlace } from '../overlays';
import { safeArea, unit, type Rect } from './units';

/** Text is measured at this font size and scaled, so wrapping never depends on the output scale. */
export const REF_PX = 100;
/** Advance width in px of `text` set in the CSS `font` (always at REF_PX). */
export type Measure = (text: string, font: string) => number;

/** Gap between the safe area's edge and the headline, in units. */
export const HEADLINE_MARGIN = 32;
/** Line height, × font size. */
export const LINE = 1.15;
/** Headline pill padding, × font size. */
const PILL_PAD_X = 0.55, PILL_PAD_Y = 0.3;
/** Badge pill padding, × font size. */
const BADGE_PAD_X = 0.62, BADGE_PAD_Y = 0.32;
/** Round badge: smallest diameter and padding around the text, × font size. */
const CIRCLE_MIN = 2.6, CIRCLE_PAD = 0.7;
/** A round badge wraps onto two lines when one line is wider than this, × font size. */
const CIRCLE_WRAP = 3.2;

export interface TextLine {
  text: string;
  x: number; // left of the line
  y: number; // baseline
  w: number;
}

export interface TextLayout {
  face: OverlayFace;
  size: number; // font size, canvas px
  color: string;
  lines: TextLine[];
}

export interface HeadlineLayout extends TextLayout {
  box: Rect; // text plus pill padding; inside the safe area
  fill: { rect: Rect; r: number; color: string; opacity: number } | null;
}

export interface BadgeLayout extends TextLayout {
  shape: BadgeShape;
  box: Rect; // a circle's bounding square
  r: number; // corner radius (a circle: its radius)
  fillColor: string;
}

export type WatermarkLayout =
  | { kind: 'logo'; imageId: string; rect: Rect; opacity: number }
  | (TextLayout & { kind: 'text'; box: Rect; opacity: number });

export interface OverlayLayout {
  headline: HeadlineLayout | null;
  badge: BadgeLayout | null;
  watermark: WatermarkLayout | null;
}

/* ---------------- text fitting ---------------- */

/** Normalizes typed text into at most `max` lines: whitespace collapsed, empty lines dropped, extra
 *  lines joined onto the last one. */
export function splitLines(text: string, max: 1 | 2): string[] {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')];
}

/** Splits one line into two at the word boundary that makes the wider line narrowest (the first
 *  such break on a tie). Null when there is only one word. */
export function balance(line: string, widthOf: (s: string) => number): [string, string] | null {
  const words = line.split(' ');
  if (words.length < 2) return null;
  let best: [string, string] | null = null, bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(widthOf(a), widthOf(b));
    if (w < bestW - 1e-9) { bestW = w; best = [a, b]; }
  }
  return best;
}

/** Widths per px of font size for one face, measured once each at REF_PX. */
function widthsFor(face: OverlayFace, measure: Measure): (s: string) => number {
  const font = fontCss(face, REF_PX);
  const memo = new Map<string, number>();
  return (s) => {
    let w = memo.get(s);
    if (w == null) { w = measure(s, font) / REF_PX; memo.set(s, w); }
    return w;
  };
}

export interface Fitted {
  lines: string[];
  size: number;
}

/**
 * Lines and font size for text that has to fit `maxW` × `maxH` (canvas px) with padX / padY (× font
 * size) on each side. At the wanted size a line that is too wide wraps at a word boundary into two
 * balanced lines (when two are allowed); whatever is still too wide or tall then shrinks to fit.
 */
export function fitText(text: string, wr: (s: string) => number, size: number, maxW: number, maxH: number, padX: number, padY: number, maxLines: 1 | 2): Fitted {
  let lines = splitLines(text, maxLines);
  if (!lines.length || !(size > 0)) return { lines: [], size: 0 };
  if (lines.length === 1 && maxLines === 2 && (wr(lines[0]) + 2 * padX) * size > maxW) {
    const two = balance(lines[0], wr);
    if (two) lines = two;
  }
  const widest = Math.max(...lines.map(wr));
  let s = size;
  const perW = widest + 2 * padX, perH = lines.length * LINE + 2 * padY;
  if (perW * s > maxW) s = maxW / perW;
  if (perH * s > maxH) s = maxH / perH;
  return { lines, size: Math.max(0, s) };
}

/* ---------------- placement ---------------- */

const inset = (r: Rect, m: number): Rect => {
  const mx = Math.min(m, r.w / 4), my = Math.min(m, r.h / 4);
  return { l: r.l + mx, t: r.t + my, w: r.w - 2 * mx, h: r.h - 2 * my };
};
const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** Keeps a w × h box inside `area`. */
function keepInside(l: number, t: number, w: number, h: number, area: Rect): Rect {
  return { l: clamp(l, area.l, area.l + area.w - w), t: clamp(t, area.t, area.t + area.h - h), w, h };
}

/** A w × h box in a corner (or the center) of `area`. */
function corner(place: OverlayCorner | WatermarkPlace, w: number, h: number, area: Rect): Rect {
  if (place === 'center') return { l: area.l + (area.w - w) / 2, t: area.t + (area.h - h) / 2, w, h };
  const l = place === 'tl' || place === 'bl' ? area.l : area.l + area.w - w;
  const t = place === 'tl' || place === 'tr' ? area.t : area.t + area.h - h;
  return { l, t, w, h };
}

/** Lines laid out in a box: aligned horizontally inside [left, left + width], stacked from `top`,
 *  each baseline centering the font's cap height in its line box. */
function placeLines(lines: string[], wr: (s: string) => number, face: OverlayFace, size: number, align: OverlayAlign, left: number, width: number, top: number): TextLine[] {
  const cap = OVERLAY_FONTS[face.font].cap;
  return lines.map((text, i) => {
    const w = wr(text) * size;
    const x = align === 'left' ? left : align === 'right' ? left + width - w : left + (width - w) / 2;
    return { text, x, y: top + i * LINE * size + (LINE * size + cap * size) / 2, w };
  });
}

/** The safe area the overlays live in (Pinterest: central 80%; Etsy: the 5:4 thumbnail crop). */
export function overlayArea(doc: Pick<Composition, 'preset' | 'W' | 'H'>): Rect {
  const p = PRESETS[doc.preset] ?? PRESETS.custom;
  const s = safeArea(p.safe, doc.W, doc.H);
  return { l: s.l, t: s.t, w: s.w, h: s.h };
}

export function layoutOverlays(doc: Composition, measure: Measure): OverlayLayout {
  const o = overlaysOf(doc);
  const u = unit(doc.W, doc.H);
  const safe = overlayArea(doc);
  return {
    headline: o.headline.enabled ? layoutHeadline(doc, safe, u, measure) : null,
    badge: o.badge.enabled ? layoutBadge(doc, safe, u, measure) : null,
    watermark: o.watermark.enabled ? layoutWatermark(doc, safe, u, measure) : null,
  };
}

function layoutHeadline(doc: Composition, safe: Rect, u: number, measure: Measure): HeadlineLayout | null {
  const h = overlaysOf(doc).headline;
  const face = resolveFace(h.font, h.weight, h.italic);
  const wr = widthsFor(face, measure);
  const area = inset(safe, HEADLINE_MARGIN * u);
  const padX = h.fill === 'pill' ? PILL_PAD_X : 0, padY = h.fill === 'none' ? 0 : PILL_PAD_Y;
  const fit = fitText(h.text, wr, h.size * u, area.w, area.h, padX, padY, 2);
  if (!fit.lines.length || !(fit.size > 0)) return null;
  const s = fit.size;
  const textW = Math.max(...fit.lines.map(wr)) * s;
  const w = textW + 2 * padX * s, ht = (fit.lines.length * LINE + 2 * padY) * s;
  const l = h.align === 'left' ? area.l : h.align === 'right' ? area.l + area.w - w : area.l + (area.w - w) / 2;
  const t = h.place === 'top' ? area.t : h.place === 'bottom' ? area.t + area.h - ht : area.t + (area.h - ht) / 2;
  const box = keepInside(l + h.dx * u, t + h.dy * u, w, ht, safe);
  const lines = placeLines(fit.lines, wr, face, s, h.align, box.l + padX * s, textW, box.t + padY * s);
  const fill =
    h.fill === 'pill' ? { rect: box, r: Math.min(ht, (LINE + 2 * padY) * s) / 2, color: h.fillColor, opacity: h.fillOpacity }
    : h.fill === 'band' ? { rect: { l: 0, t: box.t, w: doc.W, h: ht }, r: 0, color: h.fillColor, opacity: h.fillOpacity }
    : null;
  return { face, size: s, color: h.color, lines, box, fill };
}

function layoutBadge(doc: Composition, safe: Rect, u: number, measure: Measure): BadgeLayout | null {
  const b = overlaysOf(doc).badge;
  const face = resolveFace(b.font, b.weight);
  const wr = widthsFor(face, measure);
  const area = inset(safe, b.inset * u);
  let lines = splitLines(b.text, 1);
  if (!lines.length || !(b.size > 0)) return null;
  let s = b.size * u;
  let w: number, ht: number, r: number;
  if (b.shape === 'circle') {
    if (wr(lines[0]) > CIRCLE_WRAP) lines = balance(lines[0], wr) ?? lines;
    const per = Math.max(CIRCLE_MIN, Math.hypot(Math.max(...lines.map(wr)), lines.length * LINE) + CIRCLE_PAD);
    s = Math.min(s, Math.min(area.w, area.h) / per);
    w = ht = per * s;
    r = w / 2;
  } else {
    const perW = wr(lines[0]) + 2 * BADGE_PAD_X, perH = LINE + 2 * BADGE_PAD_Y;
    s = Math.min(s, area.w / perW, area.h / perH);
    w = perW * s;
    ht = perH * s;
    r = ht / 2;
  }
  const at = corner(b.corner, w, ht, area);
  const box = keepInside(at.l, at.t, w, ht, safe);
  const textH = lines.length * LINE * s;
  const placed = placeLines(lines, wr, face, s, 'center', box.l, box.w, box.t + (box.h - textH) / 2);
  return { face, size: s, color: b.color, lines: placed, shape: b.shape, box, r, fillColor: b.fillColor };
}

function layoutWatermark(doc: Composition, safe: Rect, u: number, measure: Measure): WatermarkLayout | null {
  const m = overlaysOf(doc).watermark;
  const area = inset(safe, m.inset * u);
  if (m.kind === 'logo') {
    if (!m.imageId || !(m.nw > 0 && m.nh > 0)) return null;
    const ar = m.nw / m.nh;
    let w = m.size * u * Math.sqrt(ar), h = (m.size * u) / Math.sqrt(ar);
    const f = Math.min(1, area.w / w, area.h / h);
    w *= f;
    h *= f;
    const at = corner(m.place, w, h, area);
    return { kind: 'logo', imageId: m.imageId, rect: keepInside(at.l, at.t, w, h, safe), opacity: m.opacity };
  }
  const face = resolveFace(m.font, m.weight);
  const wr = widthsFor(face, measure);
  const fit = fitText(m.text, wr, m.textSize * u, area.w, area.h, 0, 0, 1);
  if (!fit.lines.length || !(fit.size > 0)) return null;
  const s = fit.size, w = wr(fit.lines[0]) * s, ht = LINE * s;
  const at = corner(m.place, w, ht, area);
  const box = keepInside(at.l, at.t, w, ht, safe);
  const align: OverlayAlign = m.place === 'center' ? 'center' : m.place === 'tl' || m.place === 'bl' ? 'left' : 'right';
  return { kind: 'text', face, size: s, color: m.color, lines: placeLines(fit.lines, wr, face, s, align, box.l, box.w, box.t), box, opacity: m.opacity };
}
