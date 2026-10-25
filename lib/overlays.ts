/* Headline, badge and watermark: optional overlays drawn above the layouts, by one function for both
   the preview and the export (lib/render/overlays.ts). Sizes are units (1/1000 of the canvas's short
   side) and positions are relative to the safe area, so the same overlays land sensibly on any canvas
   shape. Types, defaults, the bundled fonts and the sanitizer for older saves live here. */
import type { Composition } from './model';

export type OverlayFontId = 'bricolage' | 'instrument-sans' | 'instrument-serif' | 'anton';
export type OverlayCorner = 'tl' | 'tr' | 'bl' | 'br';
export type HeadlinePlace = 'top' | 'middle' | 'bottom';
export type OverlayAlign = 'left' | 'center' | 'right';
export type HeadlineFill = 'none' | 'pill' | 'band';
export type BadgeShape = 'pill' | 'circle';
export type WatermarkPlace = OverlayCorner | 'center';

export interface Headline {
  enabled: boolean;
  text: string; // one or two lines; a '\n' forces the break
  font: OverlayFontId;
  weight: number; // wanted weight; drawn with the font's nearest bundled weight
  italic: boolean; // used when the font has an italic
  size: number; // units: font size before auto-fit
  color: string;
  place: HeadlinePlace; // top, middle or bottom of the safe area
  align: OverlayAlign; // left, center or right in the safe area (and of the lines)
  dx: number;
  dy: number; // units: offset from the placed position, kept inside the safe area
  fill: HeadlineFill; // pill behind the text, or a band across the canvas
  fillColor: string;
  fillOpacity: number; // 0–1
}

export interface Badge {
  enabled: boolean;
  text: string; // one short line ("Template", "$29")
  font: OverlayFontId;
  weight: number;
  shape: BadgeShape;
  corner: OverlayCorner;
  size: number; // units: font size
  inset: number; // units from the safe area's corner
  color: string; // text
  fillColor: string;
}

export interface Watermark {
  enabled: boolean;
  kind: 'logo' | 'text';
  imageId: string | null; // logo in the image store (lib/images.ts)
  imageName: string;
  nw: number;
  nh: number; // logo's natural size in px
  text: string;
  font: OverlayFontId;
  weight: number;
  color: string; // text
  place: WatermarkPlace;
  size: number; // units: logo size (the side of a square of the same area)
  textSize: number; // units: font size of a text watermark
  inset: number; // units from the safe area's edge
  opacity: number; // 0–1
}

export interface Overlays {
  headline: Headline;
  badge: Badge;
  watermark: Watermark;
}
export type OverlayKey = keyof Overlays;

/* ---------------- bundled fonts ---------------- */

/* Self-hosted so a headline draws the same on every machine (and in the offline e2e tests). Files in
   public/fonts, SIL OFL 1.1 with the license beside them; Fontsource 5.3.0 Latin subsets. The family
   names are our own, so an installed or UI copy (the app's Bricolage comes from Google Fonts) never
   mixes in. `cap` is the cap height per em, for centering text in a pill. */
export interface OverlayFont {
  id: OverlayFontId;
  label: string;
  family: string;
  fallback: string;
  weights: number[];
  italics: number[]; // weights that have an italic
  cap: number;
  dir: string;
  file: string; // file name stem; -latin-{weight}-{style}.woff2 follows
}

export const OVERLAY_FONTS: Record<OverlayFontId, OverlayFont> = {
  bricolage: {
    id: 'bricolage', label: 'Bricolage', family: 'Overlay Bricolage', fallback: 'ui-sans-serif, system-ui, sans-serif',
    weights: [400, 600, 800], italics: [], cap: 0.67, dir: 'bricolage-grotesque', file: 'bricolage-grotesque',
  },
  'instrument-sans': {
    id: 'instrument-sans', label: 'Instrument Sans', family: 'Overlay Instrument Sans', fallback: 'ui-sans-serif, system-ui, sans-serif',
    weights: [400, 600, 700], italics: [], cap: 0.73, dir: 'instrument-sans', file: 'instrument-sans',
  },
  'instrument-serif': {
    id: 'instrument-serif', label: 'Instrument Serif', family: 'Overlay Instrument Serif', fallback: 'Georgia, "Times New Roman", serif',
    weights: [400], italics: [400], cap: 0.73, dir: 'instrument-serif', file: 'instrument-serif',
  },
  anton: {
    id: 'anton', label: 'Anton', family: 'Overlay Anton', fallback: 'Impact, "Arial Narrow", sans-serif',
    weights: [400], italics: [], cap: 0.86, dir: 'anton', file: 'anton',
  },
};
export const OVERLAY_FONT_IDS = Object.keys(OVERLAY_FONTS) as OverlayFontId[];

export const WEIGHT_LABELS: Record<number, string> = { 400: 'Regular', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold' };

/** One face to load and draw with. */
export interface OverlayFace {
  font: OverlayFontId;
  weight: number;
  style: 'normal' | 'italic';
}

/** The bundled face closest to what was asked for: the nearest weight (the heavier one on a tie),
 *  italic only where the font has one. */
export function resolveFace(font: OverlayFontId, weight: number, italic = false): OverlayFace {
  const f = OVERLAY_FONTS[font] ?? OVERLAY_FONTS.bricolage;
  const w = f.weights.reduce((best, c) => (Math.abs(c - weight) < Math.abs(best - weight) || (Math.abs(c - weight) === Math.abs(best - weight) && c > best) ? c : best), f.weights[0]);
  return { font: f.id, weight: w, style: italic && f.italics.includes(w) ? 'italic' : 'normal' };
}

/** CSS font shorthand for a face at px. */
export function fontCss(face: OverlayFace, px: number): string {
  const f = OVERLAY_FONTS[face.font];
  return `${face.style === 'italic' ? 'italic ' : ''}${face.weight} ${+px.toFixed(3)}px "${f.family}", ${f.fallback}`;
}

export function faceFile(face: OverlayFace): string {
  const f = OVERLAY_FONTS[face.font];
  return `/fonts/${f.dir}/${f.file}-latin-${face.weight}-${face.style}.woff2`;
}

/** Every bundled face. */
export function allFaces(): OverlayFace[] {
  return OVERLAY_FONT_IDS.flatMap((id) => {
    const f = OVERLAY_FONTS[id];
    return [
      ...f.weights.map((weight): OverlayFace => ({ font: id, weight, style: 'normal' })),
      ...f.italics.map((weight): OverlayFace => ({ font: id, weight, style: 'italic' })),
    ];
  });
}

/* ---------------- defaults ---------------- */

export function defaultOverlays(): Overlays {
  return {
    headline: {
      enabled: false, text: 'A calm Shopify theme for small brands', font: 'bricolage', weight: 800, italic: false, size: 84,
      color: '#16161A', place: 'top', align: 'center', dx: 0, dy: 0, fill: 'none', fillColor: '#FFFFFF', fillOpacity: 0.9,
    },
    badge: {
      enabled: false, text: 'Template', font: 'instrument-sans', weight: 700, shape: 'pill', corner: 'bl', size: 34, inset: 32,
      color: '#FFFFFF', fillColor: '#16161A',
    },
    watermark: {
      enabled: false, kind: 'logo', imageId: null, imageName: '', nw: 0, nh: 0, text: 'yourstudio.com', font: 'instrument-sans', weight: 600,
      color: '#16161A', place: 'br', size: 110, textSize: 30, inset: 32, opacity: 0.8,
    },
  };
}

/** The composition's overlays; compositions from before overlays existed have none enabled. */
export function overlaysOf(doc: Pick<Composition, 'overlays'>): Overlays {
  return doc.overlays ?? defaultOverlays();
}

export function anyOverlay(doc: Pick<Composition, 'overlays'>): boolean {
  const o = doc.overlays;
  return !!o && (o.headline.enabled || o.badge.enabled || o.watermark.enabled);
}

/** Applies a patch to one overlay, creating the overlays block if the doc has none. Mutates. */
export function patchOverlay<K extends OverlayKey>(d: Composition, key: K, patch: Partial<Overlays[K]>): void {
  d.overlays ??= defaultOverlays();
  Object.assign(d.overlays[key], patch);
}

/** Faces the enabled text overlays draw with. */
export function facesFor(doc: Pick<Composition, 'overlays'>): OverlayFace[] {
  const o = doc.overlays;
  if (!o) return [];
  const out: OverlayFace[] = [];
  if (o.headline.enabled) out.push(resolveFace(o.headline.font, o.headline.weight, o.headline.italic));
  if (o.badge.enabled) out.push(resolveFace(o.badge.font, o.badge.weight));
  if (o.watermark.enabled && o.watermark.kind === 'text') out.push(resolveFace(o.watermark.font, o.watermark.weight));
  return out;
}

/* ---------------- limits and sanitizing ---------------- */

export const HEADLINE_SIZE = { min: 24, max: 220 };
export const HEADLINE_OFFSET = 150; // ± units
export const BADGE_SIZE = { min: 16, max: 120 };
export const WATERMARK_LOGO_SIZE = { min: 30, max: 400 };
export const WATERMARK_TEXT_SIZE = { min: 12, max: 120 };
export const INSET_MAX = 160;
export const HEADLINE_MAX_CHARS = 90;
export const BADGE_MAX_CHARS = 24;
export const WATERMARK_MAX_CHARS = 40;

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const str = (v: unknown, max: number, d: string) => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const CORNERS: OverlayCorner[] = ['tl', 'tr', 'bl', 'br'];

/** Fills in anything missing or unusable from a saved overlays block (older saves have none). */
export function sanitizeOverlays(raw: unknown): Overlays {
  const d = defaultOverlays();
  const r = obj(raw);
  const h = obj(r.headline), b = obj(r.badge), w = obj(r.watermark);
  const nw = num(w.nw, 0, 1e6, 0), nh = num(w.nh, 0, 1e6, 0);
  const imageId = typeof w.imageId === 'string' && w.imageId && nw > 0 && nh > 0 ? w.imageId : null;
  return {
    headline: {
      enabled: bool(h.enabled, d.headline.enabled),
      text: str(h.text, HEADLINE_MAX_CHARS, d.headline.text),
      font: pick(h.font, OVERLAY_FONT_IDS, d.headline.font),
      weight: num(h.weight, 100, 900, d.headline.weight),
      italic: bool(h.italic, d.headline.italic),
      size: num(h.size, HEADLINE_SIZE.min, HEADLINE_SIZE.max, d.headline.size),
      color: color(h.color, d.headline.color),
      place: pick(h.place, ['top', 'middle', 'bottom'] as const, d.headline.place),
      align: pick(h.align, ['left', 'center', 'right'] as const, d.headline.align),
      dx: num(h.dx, -HEADLINE_OFFSET, HEADLINE_OFFSET, 0),
      dy: num(h.dy, -HEADLINE_OFFSET, HEADLINE_OFFSET, 0),
      fill: pick(h.fill, ['none', 'pill', 'band'] as const, d.headline.fill),
      fillColor: color(h.fillColor, d.headline.fillColor),
      fillOpacity: num(h.fillOpacity, 0, 1, d.headline.fillOpacity),
    },
    badge: {
      enabled: bool(b.enabled, d.badge.enabled),
      text: str(b.text, BADGE_MAX_CHARS, d.badge.text),
      font: pick(b.font, OVERLAY_FONT_IDS, d.badge.font),
      weight: num(b.weight, 100, 900, d.badge.weight),
      shape: pick(b.shape, ['pill', 'circle'] as const, d.badge.shape),
      corner: pick(b.corner, CORNERS, d.badge.corner),
      size: num(b.size, BADGE_SIZE.min, BADGE_SIZE.max, d.badge.size),
      inset: num(b.inset, 0, INSET_MAX, d.badge.inset),
      color: color(b.color, d.badge.color),
      fillColor: color(b.fillColor, d.badge.fillColor),
    },
    watermark: {
      enabled: bool(w.enabled, d.watermark.enabled),
      kind: pick(w.kind, ['logo', 'text'] as const, d.watermark.kind),
      imageId,
      imageName: imageId ? str(w.imageName, 200, '') : '',
      nw: imageId ? nw : 0,
      nh: imageId ? nh : 0,
      text: str(w.text, WATERMARK_MAX_CHARS, d.watermark.text),
      font: pick(w.font, OVERLAY_FONT_IDS, d.watermark.font),
      weight: num(w.weight, 100, 900, d.watermark.weight),
      color: color(w.color, d.watermark.color),
      place: pick(w.place, [...CORNERS, 'center'] as const, d.watermark.place),
      size: num(w.size, WATERMARK_LOGO_SIZE.min, WATERMARK_LOGO_SIZE.max, d.watermark.size),
      textSize: num(w.textSize, WATERMARK_TEXT_SIZE.min, WATERMARK_TEXT_SIZE.max, d.watermark.textSize),
      inset: num(w.inset, 0, INSET_MAX, d.watermark.inset),
      opacity: num(w.opacity, 0, 1, d.watermark.opacity),
    },
  };
}
