/* Background drawing, shared by the preview <canvas> and the export.
   Preview and export must render identically: change both or neither. */
import type { Background } from '../model';
import { hexA } from './units';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Seeded xorshift32, so a seed always draws the same thing. */
export function xorshift(seed: number): () => number {
  let a = ((seed + 1) * 2654435761) >>> 0 || 1;
  return () => {
    a ^= a << 13; a >>>= 0;
    a ^= a >>> 17;
    a ^= a << 5; a >>>= 0;
    return a / 4294967296;
  };
}

/** Glow centers as fractions of the canvas: 3 of 4 quadrants (shuffled by the seed), inset 6–44% inside each. */
export function meshPoints(seed: number): [number, number][] {
  const rnd = xorshift(seed);
  const q: [number, number][] = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q.slice(0, 3).map(([qx, qy]) => [qx + 0.06 + rnd() * 0.38, qy + 0.06 + rnd() * 0.38]);
}

/** Gradient endpoints in CSS convention (0° points up), centered on a cw × ch canvas. */
export function gradientLine(angle: number, cw: number, ch: number): [number, number, number, number] {
  const a = (angle * Math.PI) / 180, sx = Math.sin(a), sy = -Math.cos(a);
  const len = Math.abs(cw * sx) + Math.abs(ch * sy);
  return [cw / 2 - (sx * len) / 2, ch / 2 - (sy * len) / 2, cw / 2 + (sx * len) / 2, ch / 2 + (sy * len) / 2];
}

/* A 160 px tile of grey noise. Seeded (not Math.random) so exports are reproducible. */
let noiseTile: HTMLCanvasElement | null = null;
export function getNoise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const [c, x] = makeCanvas(160, 160);
  const d = x.createImageData(160, 160);
  const rnd = xorshift(160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (rnd() * 255) | 0;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  noiseTile = c;
  return c;
}

let filterSupport: boolean | null = null;
/** Feature-detects ctx.filter (Safari historically ignores it). */
export function canvasFilterOK(): boolean {
  if (filterSupport != null) return filterSupport;
  try {
    const x = document.createElement('canvas').getContext('2d')!;
    if (!('filter' in x)) return (filterSupport = false);
    x.filter = 'blur(2px)';
    filterSupport = x.filter === 'blur(2px)';
  } catch {
    filterSupport = false;
  }
  return filterSupport;
}

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const natW = (img: Drawable) => ('naturalWidth' in img ? img.naturalWidth : img.width);
const natH = (img: Drawable) => ('naturalHeight' in img ? img.naturalHeight : img.height);

/** Cover-fit an image over the whole canvas; when blurred, scale up a little so the edges don't fade. */
export function drawCover(x: CanvasRenderingContext2D, img: Drawable, cw: number, ch: number, blurPx: number): void {
  const iw = natW(img), ih = natH(img);
  const over = blurPx > 0 ? 1 + Math.min(0.3, (blurPx * 3) / Math.min(cw, ch)) : 1;
  const s = Math.max(cw / iw, ch / ih) * over;
  const dw = iw * s, dh = ih * s, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
  if (blurPx > 0.5) {
    if (canvasFilterOK()) {
      x.filter = `blur(${blurPx}px)`;
      x.drawImage(img, dx, dy, dw, dh);
      x.filter = 'none';
    } else {
      const f = Math.max(1, blurPx / 2.5);
      const [t, tx] = makeCanvas(Math.max(1, Math.round(cw / f)), Math.max(1, Math.round(ch / f)));
      tx.imageSmoothingQuality = 'high';
      tx.drawImage(img, dx / f, dy / f, dw / f, dh / f);
      x.imageSmoothingQuality = 'high';
      x.drawImage(t, 0, 0, cw, ch);
    }
  } else x.drawImage(img, dx, dy, dw, dh);
}

/**
 * Paints the background over the whole of x.canvas.
 * W, H: composition size in canvas px. k: output px per canvas px (preview: scale × dpr; export: m).
 * bgImage: the decoded background image for type 'image' (null while loading or when none).
 */
export function drawBackground(x: CanvasRenderingContext2D, bg: Background, W: number, H: number, k: number, bgImage: Drawable | null): void {
  const cw = x.canvas.width, ch = x.canvas.height;
  x.save();
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  if (bg.type === 'gradient') {
    const g = x.createLinearGradient(...gradientLine(bg.grad.angle, cw, ch));
    g.addColorStop(0, bg.grad.a);
    g.addColorStop(1, bg.grad.b);
    x.fillStyle = g;
    x.fillRect(0, 0, cw, ch);
  } else if (bg.type === 'mesh') {
    const cols = bg.mesh;
    x.fillStyle = cols[0];
    x.fillRect(0, 0, cw, ch);
    const R = Math.max(cw, ch) * 0.62;
    meshPoints(bg.meshSeed).forEach(([px, py], i) => {
      const c = cols[i + 1];
      const g = x.createRadialGradient(px * cw, py * ch, 0, px * cw, py * ch, R);
      g.addColorStop(0, hexA(c, 1));
      g.addColorStop(0.45, hexA(c, 0.55));
      g.addColorStop(1, hexA(c, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, cw, ch);
    });
  } else if (bg.type === 'image') {
    x.fillStyle = bg.solid;
    x.fillRect(0, 0, cw, ch);
    if (bgImage) drawCover(x, bgImage, cw, ch, bg.blur * (Math.min(W, H) / 1000) * k);
    if (bg.dim > 0) {
      x.fillStyle = `rgba(0,0,0,${bg.dim})`;
      x.fillRect(0, 0, cw, ch);
    }
  } else {
    x.fillStyle = bg.solid;
    x.fillRect(0, 0, cw, ch);
  }
  if (bg.grain > 0) {
    const p = x.createPattern(getNoise(), 'repeat');
    if (p) {
      try {
        const s = Math.max(0.6, k * 1.2);
        p.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      } catch {
        /* pattern transforms unsupported: grain renders at 1px */
      }
      x.globalAlpha = bg.grain / 100;
      x.globalCompositeOperation = 'overlay';
      x.fillStyle = p;
      x.fillRect(0, 0, cw, ch);
    }
  }
  x.restore();
}
