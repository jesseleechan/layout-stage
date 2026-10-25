/* The "All pages" image: every page in Media in a grid (an Etsy "what's included" photo), each shown
   from the top in a portrait window, on the canvas's background with its frame. This file places
   the windows; lib/render/pages-grid.ts draws them with the same drawShot as the canvas. Pure. */
import { isSampleId, type Composition, type MediaItem, type Slot } from './model';
import { mediaOf, mediaItemOf } from './media';

/** Width / height of each page's window: the top of the page, like a page thumbnail. */
export const PAGE_WINDOW_AR = 3 / 4;
/** Margin and gap as fractions of the canvas's short side. */
const MARGIN = 0.08;
const GAP = 0.04;

export interface GridCell {
  cx: number;
  cy: number;
  w: number;
}

/** n windows of ratio `ar` on a W × H canvas, as big as they can be: the columns that give the widest
 *  windows (fewer rows on a tie), rows centered, a short last row centered too. */
export function gridCells(W: number, H: number, n: number, ar = PAGE_WINDOW_AR): GridCell[] {
  if (n <= 0) return [];
  const s = Math.min(W, H);
  const m = s * MARGIN, g = s * GAP;
  let best = { cols: 1, rows: n, w: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - 2 * m - (cols - 1) * g) / cols, ((H - 2 * m - (rows - 1) * g) / rows) * ar);
    if (w > best.w + 1e-9) best = { cols, rows, w };
  }
  const { cols, rows, w } = best;
  const h = w / ar;
  const top = (H - (rows * h + (rows - 1) * g)) / 2;
  const cells: GridCell[] = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const left = (W - (inRow * w + (inRow - 1) * g)) / 2;
    const col = k - row * cols;
    cells.push({ cx: left + col * (w + g) + w / 2, cy: top + row * (h + g) + h / 2, w });
  }
  return cells;
}

/** The pages the image shows: Media, in its order; with fewer than two there, the visible layouts. */
export function gridPages(doc: Composition): MediaItem[] {
  const media = mediaOf(doc);
  if (media.length >= 2) return media;
  const seen = new Set<string>();
  return doc.slots.slice(0, doc.count).filter((s) => !seen.has(s.imageId) && !!seen.add(s.imageId)).map(mediaItemOf);
}

/** The slots that draw the pages on a W × H canvas: each from the top of its page. */
export function gridSlots(pages: MediaItem[], W: number, H: number): Slot[] {
  return gridCells(W, H, pages.length).map((c, k) => ({
    ...mediaItemOf(pages[k]), crop: 'custom', ar: PAGE_WINDOW_AR, fx: 50, fy: 0, cx: c.cx, cy: c.cy, w: c.w,
  }));
}

/** Whether there is enough for an All pages image: at least two different real pages. */
export const hasPages = (doc: Composition) => gridPages(doc).filter((p) => !isSampleId(p.imageId)).length >= 2;
