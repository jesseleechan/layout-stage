/* One framed layout on a canvas: shadow layers, cover-cropped image, window bar, inset border.
   The DOM preview (components/Stage.tsx) draws the same thing with CSS (and an SVG for the bar, from
   the same lib/render/bar.ts geometry); keep them in step. */
import type { Frame, Slot } from '../model';
import { clampRadius, coverSource, hexA, rectOf, roundRectPath, shadowLayers } from './units';
import { drawWindowBar, windowBar } from './bar';

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * u: unit in canvas px. k: output px per canvas px (canvas shadow settings ignore transforms,
 * so everything is multiplied by k here rather than with ctx.scale).
 */
export function drawShot(x: CanvasRenderingContext2D, s: Slot, frame: Frame, u: number, k: number, img: Drawable | null): void {
  const r = rectOf(s);
  const X = r.l * k, Y = r.t * k, w = r.w * k, h = r.h * k;
  const rad = clampRadius(frame.radius * u * k, w, h);
  const bar = windowBar({ l: X, t: Y, w, h }, frame.bar);
  // The shape that casts the shadow also shows in the layout's antialiased edge pixels: there it is
  // the bar's color along the bar, so a dark bar gets no light rim. The shadow itself is the same.
  let shape: string | CanvasGradient = '#FFFFFF';
  if (bar && frame.shadow.opacity > 0) {
    const g = x.createLinearGradient(0, Y, 0, Y + h);
    const f = Math.min(1, bar.bar.h / h);
    g.addColorStop(0, bar.colors.bar);
    g.addColorStop(f, bar.colors.bar);
    g.addColorStop(f, '#FFFFFF');
    g.addColorStop(1, '#FFFFFF');
    shape = g;
  }
  shadowLayers(frame.shadow).forEach((L) => {
    x.save();
    x.shadowColor = hexA(frame.shadow.color, L.a);
    x.shadowBlur = L.b * u * k;
    x.shadowOffsetX = L.x * u * k;
    x.shadowOffsetY = L.y * u * k;
    x.fillStyle = shape;
    roundRectPath(x, X, Y, w, h, rad);
    x.fill();
    x.restore();
  });
  x.save();
  roundRectPath(x, X, Y, w, h, rad);
  x.clip();
  x.fillStyle = '#FFFFFF';
  if (bar) {
    // The bar is opaque, so white goes under the image only (none shows at the bar's antialiased
    // edges), and the separator color under the image's antialiased top edge.
    x.fillRect(X, bar.image.t, w, bar.image.h);
    x.fillStyle = bar.colors.line;
    x.fillRect(X, bar.line.t, w, bar.line.h + Math.min(1, bar.image.h));
  } else x.fillRect(X, Y, w, h);
  if (img) {
    const nw = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const nh = 'naturalHeight' in img ? img.naturalHeight : img.height;
    const ir = bar ? bar.image : { l: X, t: Y, w, h };
    if (ir.h > 0) {
      const c = coverSource(nw, nh, ir.w, ir.h, s.fx, s.fy);
      x.drawImage(img, c.sx, c.sy, c.sw, c.sh, ir.l, ir.t, ir.w, ir.h);
    }
  }
  if (bar) drawWindowBar(x, bar);
  x.restore();
  if (frame.borderW > 0) {
    const b = frame.borderW * u * k;
    x.save();
    roundRectPath(x, X + b / 2, Y + b / 2, w - b, h - b, Math.max(0, rad - b / 2));
    x.lineWidth = b;
    x.strokeStyle = frame.borderC;
    x.stroke();
    x.restore();
  }
}
