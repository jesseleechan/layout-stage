/* Export: one offscreen canvas at W·m × H·m, background first, then images in z-order.
   Uses the same drawing functions as the preview background, and the same formulas as the CSS
   preview of the images. Preview and export must render identically: change both or neither. */
import { PRESETS, type Composition, type UiState } from '../model';
import { loadImage } from '../images';
import { drawBackground, makeCanvas } from './background';
import { drawShot } from './shot';
import { exportScale, unit } from './units';
import { paintOverlays } from './overlays';

/** Draws the composition at m output px per canvas px. */
export async function renderComposition(doc: Composition, m: number): Promise<HTMLCanvasElement> {
  const visible = doc.slots.slice(0, doc.count);
  const [imgs, bgImg] = await Promise.all([
    Promise.all(visible.map((s) => loadImage(s.imageId))),
    doc.background.type === 'image' ? loadImage(doc.background.imageId) : Promise.resolve(null),
  ]);
  const [c, x] = makeCanvas(Math.round(doc.W * m), Math.round(doc.H * m));
  x.imageSmoothingQuality = 'high';
  drawBackground(x, doc.background, doc.W, doc.H, m, bgImg);
  const u = unit(doc.W, doc.H);
  doc.order.filter((i) => i < doc.count).forEach((i) => drawShot(x, doc.slots[i], doc.frame, u, m, imgs[i]));
  await paintOverlays(x, doc, m);
  return c;
}

export function exportFileName(doc: Pick<Composition, 'preset'>, w: number, h: number, format: UiState['exportFormat']): string {
  return `layout-stage-${PRESETS[doc.preset].slug}-${w}x${h}.${format === 'jpg' ? 'jpg' : 'png'}`;
}

export interface ExportResult {
  blob: Blob;
  w: number;
  h: number;
  name: string;
  format: UiState['exportFormat'];
}

/** Renders and encodes: PNG, or JPG at quality 0.92. The long side is capped at 8000 px. */
export async function exportComposition(doc: Composition, format: UiState['exportFormat'], scale: UiState['exportScale']): Promise<ExportResult> {
  const m = exportScale(doc.W, doc.H, scale);
  const c = await renderComposition(doc, m);
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.92));
  if (!blob) throw new Error('render failed');
  return { blob, w: c.width, h: c.height, name: exportFileName(doc, c.width, c.height, format), format };
}
