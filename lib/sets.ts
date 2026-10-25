/* Derived compositions for "Export all sizes" and the "Etsy listing set". Pure: each item is an
   ordinary Composition (or, for the palette card, the canvas it's drawn on), rendered later through
   lib/render like any export. Nothing here touches the store or the DOM, apart from the text
   measure the arrangement sizes the headline with (the page's by default; see arrange()). */
import { applyArrangement, arrange, arrangementOf, layoutRoom, pageMeasure } from './arrange';
import { mediaOf, putImage } from './media';
import { applyPlacement, recall } from './canvas-size';
import { clone, PRESETS, type Composition, type MediaItem, type PresetId, type Slot, type UiState } from './model';
import { gridPages, hasPages } from './pages-grid';
import { autoCrop, cropRatio, scrollAxis } from './render/units';
import type { Measure } from './render/overlay-layout';

/* ---------------- one composition, another canvas ---------------- */

const visibleOrder = (d: Composition) => d.order.filter((i) => i < d.count).join();

/**
 * The composition on another preset's canvas. Same layouts, crops, scroll positions, frame and
 * background, placed where the user left them on that canvas (lib/canvas-size.ts), else by arrange()
 * for the new shape (leaving room for a top or bottom headline, measured with `measure`). Arranged,
 * the layer order is kept when the user changed it; an untouched one follows the new shape's own (a
 * classic 3-up on square and landscape canvases puts the hero in front). On its own preset the
 * composition is returned as it is, positions included.
 */
export function forPreset(doc: Composition, preset: Exclude<PresetId, 'custom'>, measure: Measure | null = pageMeasure()): Composition {
  const d = clone(doc);
  const { w, h } = PRESETS[preset];
  if (doc.preset === preset && doc.W === w && doc.H === h) return d;
  d.preset = preset;
  d.W = w;
  d.H = h;
  const saved = recall(doc, w, h);
  if (saved) {
    applyPlacement(d, saved);
    return d;
  }
  arrange(d, d.count, measure);
  const ref = clone(doc);
  arrange(ref);
  if (visibleOrder(doc) !== visibleOrder(ref)) d.order = [...doc.order];
  return d;
}

/* ---------------- export all sizes ---------------- */

export const ALL_SIZES: Exclude<PresetId, 'custom'>[] = ['pin', 'story', 'etsy43', 'etsy11'];

export interface SizeItem {
  key: PresetId;
  label: string;
  doc: Composition;
  /** Export scale: the preset's default. */
  scale: 1 | 2;
}

export function allSizes(doc: Composition, measure: Measure | null = pageMeasure()): SizeItem[] {
  return ALL_SIZES.map((p) => ({ key: p, label: PRESETS[p].label, doc: forPreset(doc, p, measure), scale: PRESETS[p].scale }));
}

/* ---------------- Etsy listing set ---------------- */

/** Etsy takes up to 20 photos per listing (10 until 2025). */
export const ETSY_MAX_PHOTOS = 20;
const SET_PRESET = 'etsy43';

/** Shown as a phone: captured at phone width, or shown narrower than 0.6 (width / height). */
export function isPhone(s: Slot): boolean {
  if (s.source.kind === 'url') return s.source.options.width === 390;
  return cropRatio(s) < 0.6;
}

/** Shown as a desktop page: at least as wide as it is tall, and not a phone capture. */
export function isWide(s: Slot): boolean {
  if (s.source.kind === 'url' && s.source.options.width === 390) return false;
  return cropRatio(s) >= 1;
}

/** The layout the set is about: the first visible one that isn't a phone, else layout 1. */
export function mainSlot(doc: Composition): number {
  for (let i = 0; i < doc.count; i++) if (!isPhone(doc.slots[i])) return i;
  return 0;
}

/** Windows into the page may overlap by at most a third to count as different sections. */
const MIN_STEP = 0.65;

/**
 * Scroll (or pan) positions, 0–100, for section close-ups: up to three, spread evenly from the
 * start to the end of the page, only as many as the page has distinct sections. Empty when the crop
 * already shows the whole image. A page with one section gets one close-up at the current position.
 */
export function sectionStops(s: Slot): number[] {
  const axis = scrollAxis(s);
  if (!axis) return [];
  const r = cropRatio(s);
  // How many crop windows long the page is, along the scroll axis.
  const len = axis === 'y' ? s.nh / (s.nw / r) : s.nw / (s.nh * r);
  const n = Math.min(3, 1 + Math.floor((len - 1) / MIN_STEP + 1e-9));
  if (n <= 1) return [axis === 'y' ? s.fy : s.fx];
  return Array.from({ length: n }, (_, i) => Math.round((i * 100) / (n - 1)));
}

/** Words for each stop, for labels and file names. */
function stopNames(n: number, axis: 'x' | 'y'): string[] {
  if (n === 1) return ['close-up'];
  if (axis === 'y') return n === 2 ? ['top', 'bottom'] : ['top', 'middle', 'bottom'];
  return n === 2 ? ['left', 'right'] : ['left', 'center', 'right'];
}

/** A copy of `doc` on the set's canvas showing only the given layouts, in that order (bottom → top). */
function only(doc: Composition, ids: number[]): Composition {
  const d = clone(doc);
  const { w, h } = PRESETS[SET_PRESET];
  d.preset = SET_PRESET;
  d.W = w;
  d.H = h;
  const rest = [0, 1, 2].filter((i) => !ids.includes(i));
  d.slots = [...ids, ...rest].map((i) => clone(doc.slots[i])) as Composition['slots'];
  d.count = ids.length as 1 | 2 | 3;
  d.order = [0, 1, 2];
  return d;
}

/** One layout, large and centered, scrolled to `stop` (in the room a top/bottom headline leaves). */
export function closeUp(doc: Composition, i: number, stop: number, measure?: Measure | null): Composition {
  const d = only(doc, [i]);
  const s = d.slots[0];
  if (scrollAxis(s) === 'x') s.fx = stop;
  else s.fy = stop;
  const r = cropRatio(s);
  const { t, b } = layoutRoom(d, measure);
  s.w = Math.round(Math.min(d.W * 0.84, (b - t) * 0.8 * r));
  s.cx = d.W / 2;
  s.cy = (t + b) / 2;
  return d;
}

/** A desktop layout with a phone layout in front of its right edge, the pair centered (in the room a
 *  top/bottom headline leaves). */
export function desktopAndPhone(doc: Composition, desk: number, phone: number, measure?: Measure | null): Composition {
  const d = only(doc, [desk, phone]);
  const [D, P] = d.slots;
  // In desktop widths: the desktop is 1 wide; the phone is 1.2× its height, starts 20% of the
  // desktop's height lower, and 55% of it overlaps the desktop.
  const dh = 1 / cropRatio(D);
  const ph = dh * 1.2, pw = ph * cropRatio(P);
  const pl = 1 - pw * 0.55, pt = dh * 0.2;
  const gw = Math.max(1, pl + pw), gh = Math.max(dh, pt + ph);
  const { t, b } = layoutRoom(d, measure);
  const k = Math.min((d.W * 0.84) / gw, ((b - t) * 0.78) / gh);
  const ox = (d.W - gw * k) / 2, oy = t + (b - t - gh * k) / 2;
  D.w = Math.round(k);
  D.cx = Math.round(ox + k / 2);
  D.cy = Math.round(oy + (dh * k) / 2);
  P.w = Math.round(pw * k);
  P.cx = Math.round(ox + (pl + pw / 2) * k);
  P.cy = Math.round(oy + (pt + ph / 2) * k);
  return d;
}

export type SetItem =
  | { kind: 'composition'; key: string; label: string; doc: Composition }
  /** The palette card: drawn on `doc`'s canvas with its frame and background, from the colors of
   *  `doc.slots[slot]` (lib/render/palette-card.ts). */
  | { kind: 'palette'; key: string; label: string; doc: Composition; slot: number }
  /** Every page in Media in a grid on `doc`'s canvas, background and frame (lib/pages-grid.ts). */
  | { kind: 'pages'; key: string; label: string; doc: Composition; pages: MediaItem[] };

/** The layouts as the set reads them. Showcase shows pages whole, which says nothing about their
 *  shape, so its whole pages are read through the crop a new image would get (autoCrop): desktop
 *  pages at 16:10, phone pages at 9:16. */
function setView(doc: Composition): Composition {
  if (arrangementOf(doc) !== 'showcase') return doc;
  const d = clone(doc);
  for (const s of d.slots) if (s.crop === 'full') s.crop = autoCrop(s.nw, s.nh);
  return d;
}

/**
 * The Etsy listing set, on Etsy 4:3:
 * 1. hero: the current layouts on the set's canvas (forPreset);
 *    then, with two or more pages in Media, all of them in a grid (lib/pages-grid.ts);
 * 2–4. section close-ups of the main layout at up to three scroll points (none when its crop shows
 *      the whole image; see setView for showcase pages);
 * 5. desktop + phone, when the canvas has both;
 * then each other page in Media on its own (one page, from the top, in the Scroll layout);
 * last, a palette card of the main layout's colors. At most ETSY_MAX_PHOTOS in all.
 */
export function etsySet(src: Composition, measure: Measure | null = pageMeasure()): SetItem[] {
  const hero = forPreset(src, SET_PRESET, measure);
  const items: SetItem[] = [{ kind: 'composition', key: 'hero', label: 'Hero', doc: hero }];
  if (hasPages(src)) items.push({ kind: 'pages', key: 'all-pages', label: 'All pages', doc: hero, pages: gridPages(src) });
  const doc = setView(src);
  const m = mainSlot(doc);
  const main = doc.slots[m];
  const stops = sectionStops(main);
  const names = stopNames(stops.length, scrollAxis(main) ?? 'y');
  stops.forEach((stop, k) => {
    const name = names[k];
    const label = stops.length === 1 ? 'Close-up' : `${name[0].toUpperCase()}${name.slice(1)} section`;
    items.push({ kind: 'composition', key: name, label, doc: closeUp(doc, m, stop, measure) });
  });
  const visible = doc.slots.slice(0, doc.count);
  const desk = visible.findIndex(isWide);
  const phone = visible.findIndex(isPhone);
  if (desk >= 0 && phone >= 0) items.push({ kind: 'composition', key: 'desktop-phone', label: 'Desktop + phone', doc: desktopAndPhone(doc, desk, phone, measure) });
  const onHero = new Set(src.slots.slice(0, src.count).map((s) => s.imageId));
  const rest = mediaOf(src).filter((p) => !onHero.has(p.imageId)).slice(0, Math.max(0, ETSY_MAX_PHOTOS - 1 - items.length));
  rest.forEach((p, k) => {
    const d = clone(hero);
    d.count = 1;
    putImage(d, 0, p);
    applyArrangement(d, 'showcase', measure);
    items.push({ kind: 'composition', key: `page-${k + 1}`, label: p.name, doc: d });
  });
  items.push({ kind: 'palette', key: 'palette', label: 'Palette', doc: only(src, [m]), slot: 0 });
  return items.slice(0, ETSY_MAX_PHOTOS);
}

/** `01-layout-stage-etsy-hero-3000x2250.png`: numbered so the files sort in listing order. */
export function setFileName(index: number, key: string, w: number, h: number, format: UiState['exportFormat']): string {
  return `${String(index + 1).padStart(2, '0')}-layout-stage-etsy-${key}-${w}x${h}.${format === 'jpg' ? 'jpg' : 'png'}`;
}

export const ALL_SIZES_ZIP = 'layout-stage-all-sizes.zip';
export const ETSY_SET_ZIP = 'layout-stage-etsy-set.zip';
export const PAGES_ZIP = 'layout-stage-all-pages.zip';
export const VARIATIONS_ZIP = 'layout-stage-variations.zip';

/** The All pages image at each size the shop needs: Etsy 4:3, Pinterest pin, Etsy square. */
export function pagesImages(src: Composition): { key: string; label: string; preset: Exclude<PresetId, 'custom'>; doc: Composition; pages: MediaItem[] }[] {
  const pages = gridPages(src);
  return (['etsy43', 'pin', 'etsy11'] as const).map((p) => ({
    key: `all-pages-${PRESETS[p].slug}`, label: PRESETS[p].label, preset: p, doc: { ...clone(src), preset: p, W: PRESETS[p].w, H: PRESETS[p].h }, pages,
  }));
}
