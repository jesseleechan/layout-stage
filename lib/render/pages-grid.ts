/* Draws the "All pages" image (lib/pages-grid.ts places the pages): the canvas's background at the
   image's size, then each page with the canvas's frame, through the same drawShot as every export. */
import type { Composition, MediaItem } from '../model';
import { loadImage } from '../images';
import { gridSlots } from '../pages-grid';
import { drawBackground, makeCanvas } from './background';
import { drawShot } from './shot';
import { unit } from './units';

/** The pages on a W × H canvas, at m output px per canvas px. */
export async function renderPagesGrid(doc: Composition, pages: MediaItem[], W: number, H: number, m: number): Promise<HTMLCanvasElement> {
  const slots = gridSlots(pages, W, H);
  const [imgs, bgImg] = await Promise.all([
    Promise.all(slots.map((s) => loadImage(s.imageId))),
    doc.background.type === 'image' ? loadImage(doc.background.imageId) : Promise.resolve(null),
  ]);
  const [c, x] = makeCanvas(Math.round(W * m), Math.round(H * m));
  x.imageSmoothingQuality = 'high';
  drawBackground(x, doc.background, W, H, m, bgImg);
  const u = unit(W, H);
  slots.forEach((s, k) => drawShot(x, s, doc.frame, u, m, imgs[k] ?? null));
  return c;
}
