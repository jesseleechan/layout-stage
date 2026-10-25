/* The palette card of the Etsy listing set: a site's main colors as large swatches with hex codes and
   the layout's name, on a card framed like the layouts, over the composition's background.
   Export only, so there is no preview twin; the background and the frame are drawn by the same
   functions as every export (drawBackground, drawShot). */
import type { Composition, Slot } from '../model';
import { lchToHex, type Palette, type Swatch } from '../palette';
import { loadImage } from '../images';
import { drawBackground, makeCanvas } from './background';
import { drawShot } from './shot';
import { imageRect } from './bar';
import { hexA, roundRectPath, unit } from './units';

const SANS = '"Instrument Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const MAX_SWATCHES = 6;

/** Waits (briefly) for the UI fonts, so the card uses them when they're available. */
async function fontsReady(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const want = [`600 64px ${SANS}`, `500 64px ${SANS}`, `500 64px ${MONO}`];
  await Promise.race([
    Promise.all(want.map((f) => fonts.load(f).catch(() => []))),
    new Promise((res) => setTimeout(res, 1500)),
  ]);
}

/** Relative luminance (WCAG). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Text on the card: the site's own text color when it's a calm, legible one; else a neutral. */
function textColor(p: Palette): string {
  const bg = p.background.hex;
  if (p.ink !== p.background && p.ink.chroma < 20 && contrast(p.ink.hex, bg) >= 7) return p.ink.hex;
  return p.dark ? lchToHex(95, 2, p.background.hue) : lchToHex(15, 4, p.background.hue);
}

/** The colors to show: the background first, then the rest by rank. */
export function cardSwatches(p: Palette): Swatch[] {
  return [p.background, ...p.colors.filter((s) => s !== p.background)].slice(0, MAX_SWATCHES);
}

function rgbText(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `RGB ${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Sets a font, shrinking it until `text` fits in `maxW`; returns the size used. */
function fitFont(x: CanvasRenderingContext2D, text: string, weight: string, size: number, fam: string, maxW: number, min: number): number {
  let s = size;
  x.font = `${weight} ${s}px ${fam}`;
  while (s > min && x.measureText(text).width > maxW) {
    s = Math.max(min, s * 0.92);
    x.font = `${weight} ${s}px ${fam}`;
  }
  return s;
}

/** Shortens `text` with an ellipsis until it fits in the current font. */
function ellipsize(x: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (x.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** The card's face, cw × ch output px: name, swatches, hex codes. */
function drawFace(cw: number, ch: number, name: string, p: Palette): HTMLCanvasElement {
  const [c, x] = makeCanvas(cw, ch);
  const s = cw / 2400; // laid out on a 2400 px wide card
  const ink = textColor(p);
  const pad = 150 * s;
  x.fillStyle = p.background.hex;
  x.fillRect(0, 0, cw, ch);
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
  const hasLS = 'letterSpacing' in x;

  // Eyebrow and name.
  x.fillStyle = hexA(ink, 0.6);
  x.font = `600 ${30 * s}px ${SANS}`;
  if (hasLS) x.letterSpacing = `${6 * s}px`;
  x.fillText('COLOR PALETTE', pad, pad + 26 * s);
  if (hasLS) x.letterSpacing = '0px';
  x.fillStyle = ink;
  fitFont(x, name, '600', 104 * s, SANS, cw - 2 * pad, 56 * s);
  x.fillText(ellipsize(x, name, cw - 2 * pad), pad - 4 * s, pad + 164 * s);

  // Swatches.
  const sw = cardSwatches(p);
  const n = sw.length;
  const gap = 40 * s;
  const top = pad + 270 * s;
  const labels = 150 * s;
  const w = (cw - 2 * pad - gap * (n - 1)) / n;
  const h = ch - pad - labels - top;
  const r = Math.min(28 * s, w / 2);
  sw.forEach((col, i) => {
    const X = pad + i * (w + gap);
    roundRectPath(x, X, top, w, h, r);
    x.fillStyle = col.hex;
    x.fill();
    x.lineWidth = Math.max(1, 2 * s);
    x.strokeStyle = hexA(ink, 0.14);
    x.stroke();
    x.fillStyle = ink;
    fitFont(x, col.hex, '500', 46 * s, MONO, w, 24 * s);
    x.fillText(col.hex, X, top + h + 76 * s);
    x.fillStyle = hexA(ink, 0.6);
    fitFont(x, rgbText(col.hex), '500', 28 * s, SANS, w, 16 * s);
    x.fillText(rgbText(col.hex), X, top + h + 124 * s);
  });
  return c;
}

/** The layout name as a title: file names lose their extension. */
export function cardTitle(slot: Pick<Slot, 'name' | 'source'>): string {
  const n = (slot.name || '').trim();
  if (!n) return 'Site colors';
  return slot.source.kind === 'file' ? n.replace(/\.(png|jpe?g|webp|gif|avif)$/i, '') : n;
}

/**
 * Draws the palette card at m output px per canvas px: `doc`'s background over the whole canvas,
 * then a card with `doc`'s frame (corners, border, shadow) holding the colors of `slot`.
 */
export async function renderPaletteCard(doc: Composition, slot: Slot, palette: Palette, m: number): Promise<HTMLCanvasElement> {
  const [bgImg] = await Promise.all([
    doc.background.type === 'image' ? loadImage(doc.background.imageId) : Promise.resolve(null),
    fontsReady(),
  ]);
  const [c, x] = makeCanvas(Math.round(doc.W * m), Math.round(doc.H * m));
  x.imageSmoothingQuality = 'high';
  drawBackground(x, doc.background, doc.W, doc.H, m, bgImg);
  // The card: 80% of the width (at most 74% of the height), 1.5 : 1.
  const w = Math.round(Math.min(doc.W * 0.8, doc.H * 0.74 * 1.5));
  const h = Math.round(w / 1.5);
  // The face fills the card below its window bar (if the frame has one) exactly, so nothing is cropped.
  const faceH = imageRect({ l: 0, t: 0, w, h }, doc.frame.bar).h;
  const face = drawFace(Math.round(w * m), Math.round(faceH * m), cardTitle(slot), palette);
  const card: Slot = { ...slot, crop: 'full', nw: w, nh: h, fx: 50, fy: 50, cx: doc.W / 2, cy: doc.H / 2, w };
  drawShot(x, card, doc.frame, unit(doc.W, doc.H), m, face);
  face.width = face.height = 0;
  return c;
}
