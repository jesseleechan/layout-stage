/* Re-capture and desktop + phone captures: where an image lands, and how a layout keeps its framing
   when its page is captured again. Pure; used by the store (landCapture) and lib/capture/jobs.ts. */
import type { CaptureOptions, Composition, Slot } from '../model';
import { coverSource, cropRatio, scrollAxis } from '../render/units';

export type Framing = Pick<Slot, 'crop' | 'ar' | 'fx' | 'fy' | 'cx' | 'cy' | 'w'>;

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The framing a layout keeps when its image is replaced by a new capture of the same page (`next`
 *  is the new image's size): the same crop, position and width, and the same part of the page in
 *  view. Scroll keeps the window's top at the same page position (in page widths, so 1× and 2×
 *  agree); when the page is now too short for that, it shows the bottom. A window pinned to the
 *  bottom (a footer) stays at the bottom. A Full crop takes the new image's shape; a frame that would
 *  grow taller than both its old height and 90% of the canvas height (H) is narrowed to fit. */
export function reframe(prev: Slot, next: Pick<Slot, 'nw' | 'nh'>, H: number): Framing {
  const s: Slot = { ...prev, nw: next.nw, nh: next.nh };
  if (s.crop === 'full') {
    const maxH = Math.max(prev.w / cropRatio(prev), H * 0.9); // never taller than it was, or than 90%
    if (s.w / cropRatio(s) > maxH) s.w = Math.round(maxH * cropRatio(s));
  }
  if (scrollAxis(s) === 'y' && scrollAxis(prev) === 'y') {
    if (prev.fy >= 99.5) s.fy = 100;
    else {
      const was = coverSource(prev.nw, prev.nh, prev.w, prev.w / cropRatio(prev), prev.fx, prev.fy);
      const now = coverSource(s.nw, s.nh, s.w, s.w / cropRatio(s), s.fx, 0);
      const hidden = s.nh - now.sh;
      s.fy = hidden > 0 ? round2(clampPct(((was.sy / prev.nw) * s.nw * 100) / hidden)) : 0;
    }
  }
  return { crop: s.crop, ...(s.crop === 'custom' ? { ar: s.ar } : {}), fx: s.fx, fy: s.fy, cx: s.cx, cy: s.cy, w: s.w };
}

/** The drop-elsewhere rule for one image (as for an upload): the first sample layout, else a new
 *  layout, else layout 1. Never the layout `avoid` (the other half of a desktop + phone pair). */
export function dropSlot(doc: Composition, avoid = -1): { i: number; added: boolean } {
  const i = doc.slots.findIndex((s, k) => k < doc.count && k !== avoid && s.source.kind === 'sample');
  if (i >= 0) return { i, added: false };
  if (doc.count < 3) return { i: doc.count, added: true };
  return { i: avoid === 0 ? 1 : 0, added: false };
}

/** Desktop + phone: the phone's layout is the one after the target, or (null) the drop-elsewhere
 *  rule when there is no target or it is the last layout. */
export const pairTarget = (doc: Pick<Composition, 'count'>, target: number | null): number | null =>
  target != null && target + 1 < doc.count ? target + 1 : null;

/** Desktop + phone: the same page twice, Desktop 1440 full page and Phone 390 first screen, with the
 *  other options as chosen. */
export function pairOptions(options: CaptureOptions): [CaptureOptions, CaptureOptions] {
  return [
    { ...options, width: 1440, fullPage: true },
    { ...options, width: 390, fullPage: false },
  ];
}

export interface Recapturable {
  i: number;
  url: string;
  options: CaptureOptions;
  needsPassword: boolean;
}

/** The visible layouts that came from a URL, in order. */
export function recapturable(doc: Composition): Recapturable[] {
  const out: Recapturable[] = [];
  for (let i = 0; i < doc.count; i++) {
    const src = doc.slots[i].source;
    if (src.kind === 'url') out.push({ i, url: src.url, options: src.options, needsPassword: !!src.needsPassword });
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
