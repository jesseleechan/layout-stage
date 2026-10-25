/* The window bar: a thin Safari-like bar across the top of a layout. All of its geometry comes from
   windowBar(), which the DOM preview (components/Stage.tsx) and the canvas (lib/render/shot.ts) both
   read, so they match by construction. Preview and export must render identically: change both or
   neither. Pure, except drawWindowBar (canvas). */
import { roundRectPath, type Rect } from './units';

export type BarKind = 'light' | 'dark';

/** The bar's kind, or null when there is none: anything but 'light' / 'dark' draws no bar. */
export const barKind = (bar: unknown): BarKind | null => (bar === 'light' || bar === 'dark' ? bar : null);

export const BAR_COLORS: Record<BarKind, { bar: string; line: string; field: string }> = {
  light: { bar: '#F3F2EF', line: '#E2E0DB', field: '#E4E2DD' },
  dark: { bar: '#2B2A2D', line: '#1D1C1F', field: '#3D3C40' },
};
/** Close, minimize, zoom. */
export const BAR_DOTS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;

export interface BarDot {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface WindowBar {
  kind: BarKind;
  colors: { bar: string; line: string; field: string };
  /** The whole bar, inside the top of the slot rect. */
  bar: Rect;
  /** The separator along the bar's bottom edge (inside the bar). */
  line: Rect;
  dots: BarDot[];
  /** The address field; its ends are fully rounded (radius = h / 2). */
  field: Rect;
  /** Where the image is cover-cropped: the slot rect below the bar. */
  image: Rect;
}

/** Bar height as a fraction of the slot's width. */
export const BAR_H = 0.036;

/**
 * The bar inside slot rect `r` (any units: canvas px, output px, or local px with l = t = 0; every
 * figure scales with r). Null when `bar` draws none, in which case the image fills r.
 * `h` overrides the bar height; only the tiny style-tile mock uses it, so the bar stays legible there.
 */
export function windowBar(r: Rect, bar: unknown, h: number = r.w * BAR_H): WindowBar | null {
  const kind = barKind(bar);
  if (!kind) return null;
  const lineH = h * 0.045;
  const dotR = (h * 0.27) / 2;
  const cy = r.t + h / 2;
  const fw = r.w * 0.42, fh = h * 0.5;
  return {
    kind,
    colors: BAR_COLORS[kind],
    bar: { l: r.l, t: r.t, w: r.w, h },
    line: { l: r.l, t: r.t + h - lineH, w: r.w, h: lineH },
    dots: BAR_DOTS.map((color, j) => ({ cx: r.l + h * 0.62 + j * h * 0.44, cy, r: dotR, color })),
    field: { l: r.l + (r.w - fw) / 2, t: cy - fh / 2, w: fw, h: fh },
    image: { l: r.l, t: r.t + h, w: r.w, h: r.h - h },
  };
}

/** The rect the image is cover-cropped into: below the bar, or all of r without one. */
export const imageRect = (r: Rect, bar: unknown): Rect => windowBar(r, bar)?.image ?? r;

/** Draws the bar (call inside the slot's clip, after the image). Geometry in output px. */
export function drawWindowBar(x: CanvasRenderingContext2D, b: WindowBar): void {
  x.fillStyle = b.colors.bar;
  x.fillRect(b.bar.l, b.bar.t, b.bar.w, b.bar.h);
  x.fillStyle = b.colors.line;
  x.fillRect(b.line.l, b.line.t, b.line.w, b.line.h);
  for (const d of b.dots) {
    x.fillStyle = d.color;
    x.beginPath();
    x.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = b.colors.field;
  roundRectPath(x, b.field.l, b.field.t, b.field.w, b.field.h, b.field.h / 2);
  x.fill();
}
