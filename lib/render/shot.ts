/* One framed layout on a canvas: shadow layers, cover-cropped image, inset border.
   The DOM preview (components/Stage.tsx) draws the same thing with CSS; keep them in step. */
import type { Frame, Slot } from '../model';
import { clampRadius, coverSource, hexA, rectOf, roundRectPath, shadowLayers, zoomOf } from './units';

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * u: unit in canvas px. k: output px per canvas px (canvas shadow settings ignore transforms,
 * so everything is multiplied by k here rather than with ctx.scale).
 */
export function drawShot(x: CanvasRenderingContext2D, s: Slot, frame: Frame, u: number, k: number, img: Drawable | null): void {
  const r = rectOf(s);
  const X = r.l * k, Y = r.t * k, w = r.w * k, h = r.h * k;
  const rad = clampRadius(frame.radius * u * k, w, h);
  shadowLayers(frame.shadow).forEach((L) => {
    x.save();
    x.shadowColor = hexA(frame.shadow.color, L.a);
    x.shadowBlur = L.b * u * k;
    x.shadowOffsetX = L.x * u * k;
    x.shadowOffsetY = L.y * u * k;
    x.fillStyle = '#FFFFFF';
    roundRectPath(x, X, Y, w, h, rad);
    x.fill();
    x.restore();
  });
  x.save();
  roundRectPath(x, X, Y, w, h, rad);
  x.clip();
  x.fillStyle = '#FFFFFF';
  x.fillRect(X, Y, w, h);
  if (img) {
    const nw = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const nh = 'naturalHeight' in img ? img.naturalHeight : img.height;
    const c = coverSource(nw, nh, w, h, s.fx, s.fy, zoomOf(s));
    x.drawImage(img, c.sx, c.sy, c.sw, c.sh, X, Y, w, h);
  }
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
