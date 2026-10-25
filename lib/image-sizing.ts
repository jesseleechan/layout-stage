/* How big a stored image and its thumbnail are. Pure (no DOM), so it's unit-tested; lib/images.ts does
   the drawing.

   Storage budget. Exports read a window of each image, never the whole of a tall one, so what counts is
   how many source px a window needs across: the largest realistic use is an Etsy 4:3 canvas (3000 px
   wide at 1×) with a layout ~70% wide, ~2100 export px, and a Pinterest pin at 2× with a layout ~78%
   wide is ~1560 export px. Captures top out at 1440 CSS px × 2 = 2880 px, so width beyond 2880 never
   helps. Height only adds scroll range, but it costs memory: a full-page capture can be 2880 × 24,000
   (69 MP, ~276 MB decoded), and every display decodes it. So:
   - width ≤ 2880;
   - area ≤ 2880 × 11,520 ≈ 33.2 MP (~133 MB decoded): a 5,760 CSS px page at 2× keeps its full width,
     taller ones shrink proportionally (a 10,800 CSS px page still has the ~2100 px the Etsy case needs);
   - longest side ≤ 16,383: WebP can't encode more (its format limit), some browsers can't decode or
     draw images with a side over 16,384 (Firefox's Direct2D surfaces on Windows, GPU texture limits on
     canvas draws) and none handle more than 32,767, so the 2880 × 24,000 capture is stored at
     1965 × 16,383 (32.2 MP, ~7% short of the Etsy case);
   - never upscale. Images within the budget are stored as they are.
   iOS Safari also refuses canvases over 4096² (16.7 MP); the downscaled copy is drawn on a canvas, so
   there it is retried within IOS_CANVAS_MAX_PX (lib/images.ts). */

export interface Budget {
  /** Widest stored image, px. */
  maxW: number;
  /** Longest stored side, px. */
  maxSide: number;
  /** Most stored pixels. */
  maxPx: number;
}

export const STORE_BUDGET: Budget = { maxW: 2880, maxSide: 16383, maxPx: 2880 * 11520 };

/** iOS Safari's canvas area limit: a bigger canvas silently draws nothing. */
export const IOS_CANVAS_MAX_PX = 4096 * 4096;

export interface Size {
  w: number;
  h: number;
}

/** The size to store an nw × nh image at: itself when it's within the budget, else proportionally
 *  smaller (never larger), rounded down so it stays within every limit. */
export function storedSize(nw: number, nh: number, b: Budget = STORE_BUDGET): Size & { scaled: boolean } {
  const s = Math.min(1, b.maxW / nw, b.maxSide / Math.max(nw, nh), Math.sqrt(b.maxPx / (nw * nh)));
  if (s >= 1) return { w: nw, h: nh, scaled: false };
  // The epsilon keeps an exact limit (2880 / nw · nw) from flooring to 2879.
  const fit = (v: number) => Math.max(1, Math.floor(v * s + 1e-6));
  return { w: fit(nw), h: fit(nh), scaled: true };
}

/* Thumbnails. The Layouts row shows 54 × 36 (object-fit: cover, object-position 50% 0) and the
   background thumb 64 × 48 (cover, centered). A thumbnail covers a 216 × 144 box (the row's 3:2 at 4×,
   the background's 4:3 at 3×), so both stay sharp at 2× DPR and beyond. Its shape is clamped between
   1:2 and 3:2: a wider image keeps its center (like cover), a taller one its top (like the row's
   object-position), so the row shows exactly what it showed before, and so does the background thumb
   for anything not taller than 1:2. */
export const THUMB_BOX: Size = { w: 216, h: 144 };
export const THUMB_MIN_RATIO = 1 / 2;
export const THUMB_MAX_RATIO = 3 / 2;

export interface ThumbPlan extends Size {
  /** Source rectangle, in image px. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Which part of an nw × nh image the thumbnail shows, and its size in px (never upscaled). */
export function thumbPlan(nw: number, nh: number): ThumbPlan {
  const r = nw / nh;
  let sx = 0, sw = nw, sh = nh;
  if (r > THUMB_MAX_RATIO) {
    sw = nh * THUMB_MAX_RATIO;
    sx = (nw - sw) / 2;
  } else if (r < THUMB_MIN_RATIO) sh = nw / THUMB_MIN_RATIO;
  const k = Math.min(1, Math.max(THUMB_BOX.w / sw, THUMB_BOX.h / sh));
  return { sx, sy: 0, sw, sh, w: Math.max(1, Math.round(sw * k)), h: Math.max(1, Math.round(sh * k)) };
}

/** The canvas sizes a downscale from sw × sh to tw × th draws through, ending with tw × th: it halves
 *  until one more halving would pass the target, so every draw scales by at least 0.5, which the
 *  browser's smoothing resamples cleanly. Steps over `maxPx` are skipped (a canvas that big may not
 *  exist, e.g. on iOS); the draw before them then scales by less than 0.5. */
export function downscaleSteps(sw: number, sh: number, tw: number, th: number, maxPx = Infinity): Size[] {
  const f = Math.min(tw / sw, th / sh);
  const n = f >= 0.5 ? 0 : Math.ceil(Math.log2(1 / f) - 1e-9) - 1;
  const steps: Size[] = [];
  for (let k = 1; k <= n; k++) {
    const w = Math.round(sw / 2 ** k), h = Math.round(sh / 2 ** k);
    if (w * h <= maxPx) steps.push({ w, h });
  }
  steps.push({ w: tw, h: th });
  return steps;
}
