/* Units, geometry and frame math shared by the DOM preview and the canvas export.
   Preview and export must render identically: change both or neither. */
import { CROPS, EXPORT_MAX_SIDE, type Composition, type CropId, type Shadow, type Slot } from '../model';

/** 1 unit = 1/1000 of the canvas's short side. Radius, border, shadow and background blur are in units. */
export const unit = (W: number, H: number) => Math.min(W, H) / 1000;

/** Width / height of the slot's frame: the preset's, the free height's (a custom crop), or the
 *  image's own (Full). */
export function cropRatio(s: Pick<Slot, 'crop' | 'nw' | 'nh' | 'ar'>): number {
  if (s.crop === 'custom') return s.ar && s.ar > 0 ? s.ar : s.nw / s.nh;
  const c = CROPS.find((c) => c.id === s.crop);
  return c && c.ratio ? c.ratio : s.nw / s.nh;
}

export interface Rect {
  l: number;
  t: number;
  w: number;
  h: number;
}

/** The slot's rectangle in canvas px, optionally at another center. */
export function rectOf(s: Slot, cx: number = s.cx, cy: number = s.cy): Rect {
  const w = s.w;
  const h = w / cropRatio(s);
  return { l: cx - w / 2, t: cy - h / 2, w, h };
}

/** Which axis the Scroll/Pan slider moves, or null when the crop shows the whole image. */
export function scrollAxis(s: Pick<Slot, 'crop' | 'nw' | 'nh' | 'ar'>): 'x' | 'y' | null {
  const ar = cropRatio(s);
  const nr = s.nw / s.nh;
  if (Math.abs(ar - nr) < 0.01) return null;
  return nr < ar ? 'y' : 'x';
}

/** Starting crop for a newly added image. */
export function autoCrop(nw: number, nh: number): CropId {
  const nr = nw / nh;
  if (nr >= 0.9) return 'full';
  if (nw >= 1280) return '16:10';
  return nr < 0.4 ? '9:16' : 'full';
}

/** Caps the slot's height at 90% of the canvas (on add and crop change). Mutates. */
export function capHeight(s: Slot, H: number): void {
  const maxH = H * 0.9;
  const r = cropRatio(s);
  if (s.w / r > maxH) s.w = Math.round(maxH * r);
}

/** Corner radius in output px, clamped to half the shorter side. */
export const clampRadius = (r: number, w: number, h: number) => Math.max(0, Math.min(r, w / 2, h / 2));

export function hexA(hex: string, a: number): string {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export interface ShadowLayer {
  x: number;
  y: number;
  b: number; // blur
  a: number; // opacity
}

/** Main layer plus, when blurred, a tighter ambient layer. Values in units. */
export function shadowLayers(sh: Shadow): ShadowLayer[] {
  if (!(sh.opacity > 0)) return [];
  const L: ShadowLayer[] = [{ x: sh.x, y: sh.y, b: sh.blur, a: sh.opacity }];
  if (sh.blur > 0) L.push({ x: sh.x * 0.2, y: sh.y * 0.18 + 1, b: sh.blur * 0.22 + 2, a: Math.min(1, sh.opacity * 0.55) });
  return L;
}

/** CSS box-shadow for the preview. `u` is the unit in canvas px. */
export function shadowCSS(sh: Shadow, u: number): string {
  return (
    shadowLayers(sh)
      .map((L) => `${(L.x * u).toFixed(2)}px ${(L.y * u).toFixed(2)}px ${(L.b * u).toFixed(2)}px ${hexA(sh.color, L.a)}`)
      .join(', ') || 'none'
  );
}

/** Rounded-rect path (arcTo corners), identical to the prototype's rr(). */
export function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number): void {
  r = clampRadius(r, w, h);
  x.beginPath();
  x.moveTo(X + r, Y);
  x.lineTo(X + w - r, Y);
  x.arcTo(X + w, Y, X + w, Y + r, r);
  x.lineTo(X + w, Y + h - r);
  x.arcTo(X + w, Y + h, X + w - r, Y + h, r);
  x.lineTo(X + r, Y + h);
  x.arcTo(X, Y + h, X, Y + h - r, r);
  x.lineTo(X, Y + r);
  x.arcTo(X, Y, X + r, Y, r);
  x.closePath();
}

/** Export multiplier: the chosen 1× / 2×, reduced so the long side stays within 8000 px. */
export function exportScale(W: number, H: number, m: number): number {
  const long = Math.max(W, H);
  return long * m > EXPORT_MAX_SIDE ? EXPORT_MAX_SIDE / long : m;
}

export function exportSize(doc: Pick<Composition, 'W' | 'H'>, m: number): { w: number; h: number; m: number } {
  const k = exportScale(doc.W, doc.H, m);
  return { w: Math.round(doc.W * k), h: Math.round(doc.H * k), m: k };
}

/** Bounding box of the visible slots. */
export function groupBounds(doc: Composition): Rect {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (let i = 0; i < doc.count; i++) {
    const q = rectOf(doc.slots[i]);
    l = Math.min(l, q.l); t = Math.min(t, q.t); r = Math.max(r, q.l + q.w); b = Math.max(b, q.t + q.h);
  }
  return { l, t, w: r - l, h: b - t };
}

/** Safe-area rectangle in canvas px and its label. */
export function safeArea(safe: 'inset' | 'etsy', W: number, H: number): Rect & { label: string } {
  if (safe === 'etsy') {
    let w: number, h: number;
    if (W / H > 1.25) { h = H; w = h * 1.25; } else { w = W; h = w / 1.25; }
    return { l: (W - w) / 2, t: (H - h) / 2, w, h, label: 'Etsy thumbnail crop · 5:4' };
  }
  return { l: W * 0.1, t: H * 0.1, w: W * 0.8, h: H * 0.8, label: 'Keep key content inside · central 80%' };
}

/** Cover crop, identical to CSS object-fit: cover with object-position fx% fy%. Returns the source rect. */
export function coverSource(nw: number, nh: number, w: number, h: number, fx: number, fy: number) {
  const sc = Math.max(w / nw, h / nh);
  const sw = w / sc, sh = h / sc;
  return { sx: ((nw - sw) * fx) / 100, sy: ((nh - sh) * fy) / 100, sw, sh };
}
