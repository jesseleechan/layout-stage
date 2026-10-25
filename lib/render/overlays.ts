/* Draws the headline, badge and watermark above the layouts. One function for both surfaces: the
   preview's transparent overlay canvas (components/OverlayCanvas.tsx) and the export
   (lib/render/export.ts) call drawOverlays with the same composition and their own k (output px per
   canvas px), and the layout it draws (overlay-layout.ts) never depends on k, so the two can't drift.
   Preview and export must render identically: change both or neither. */
import type { Composition } from '../model';
import { anyOverlay, fontCss, overlaysOf } from '../overlays';
import { loadImage } from '../images';
import { hexA, roundRectPath } from './units';
import { layoutOverlays, type Measure, type TextLayout } from './overlay-layout';
import { canvasMeasure, loadOverlayFonts } from './overlay-fonts';

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface OverlayImages {
  /** The decoded watermark logo (null while loading or when there is none). */
  logo: Drawable | null;
}

function drawText(x: CanvasRenderingContext2D, t: TextLayout, k: number): void {
  x.font = fontCss(t.face, t.size * k);
  x.fillStyle = t.color;
  x.textAlign = 'left';
  x.textBaseline = 'alphabetic';
  for (const l of t.lines) x.fillText(l.text, l.x * k, l.y * k);
}

/** Draws the enabled overlays at k output px per canvas px. The caller makes sure their fonts are
 *  loaded (loadOverlayFonts) so the measure and the drawing use the same faces. */
export function drawOverlays(x: CanvasRenderingContext2D, doc: Composition, k: number, imgs: OverlayImages, measure: Measure = canvasMeasure): void {
  if (!anyOverlay(doc)) return;
  const L = layoutOverlays(doc, measure);
  x.save();
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  const wm = L.watermark;
  if (wm) {
    x.globalAlpha = Math.max(0, Math.min(1, wm.opacity));
    if (wm.kind === 'logo') {
      if (imgs.logo) x.drawImage(imgs.logo, wm.rect.l * k, wm.rect.t * k, wm.rect.w * k, wm.rect.h * k);
    } else drawText(x, wm, k);
    x.globalAlpha = 1;
  }

  const h = L.headline;
  if (h) {
    if (h.fill && h.fill.opacity > 0) {
      const r = h.fill.rect;
      x.fillStyle = hexA(h.fill.color, h.fill.opacity);
      roundRectPath(x, r.l * k, r.t * k, r.w * k, r.h * k, h.fill.r * k);
      x.fill();
    }
    drawText(x, h, k);
  }

  const b = L.badge;
  if (b) {
    const r = b.box;
    x.fillStyle = b.fillColor;
    if (b.shape === 'circle') {
      x.beginPath();
      x.arc((r.l + r.w / 2) * k, (r.t + r.h / 2) * k, b.r * k, 0, Math.PI * 2);
    } else roundRectPath(x, r.l * k, r.t * k, r.w * k, r.h * k, b.r * k);
    x.fill();
    drawText(x, b, k);
  }
  x.restore();
}

/** Export: waits for the overlay fonts and the logo, then draws. Does nothing without overlays. */
export async function paintOverlays(x: CanvasRenderingContext2D, doc: Composition, k: number): Promise<void> {
  if (!anyOverlay(doc)) return;
  const wm = overlaysOf(doc).watermark;
  const [, logo] = await Promise.all([loadOverlayFonts(doc), wm.enabled && wm.kind === 'logo' ? loadImage(wm.imageId) : Promise.resolve(null)]);
  drawOverlays(x, doc, k, { logo });
}
