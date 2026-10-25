/* The media gallery: every image added to a project (upload, drop, paste, capture) is kept in
   `doc.media`, up to MAX_MEDIA, so it can go into any layout again without adding it again (Shots'
   media picker). The gallery is part of the canvas: it autosaves, syncs with the project and undoes
   with everything else. Pure: the store calls these inside its recipes. */
import { arrangementOf, showcaseCrop } from './arrange';
import { setCropOf } from './crop';
import { clone, isSampleId, type Composition, type MediaItem, type Slot } from './model';
import { autoCrop, capHeight, cropRatio } from './render/units';

/** How many images a project keeps. Each is stored at up to ~33 MP (lib/image-sizing.ts) and synced
 *  with the project, and twelve fill the panel's grid in three rows of four. */
export const MAX_MEDIA = 12;

/** The drag type of a gallery image dragged onto a layout (its data is the image id). */
export const MEDIA_DRAG = 'application/x-layout-stage-media';

export const mediaOf = (d: Pick<Composition, 'media'>): MediaItem[] => d.media ?? [];

export const mediaItemOf = (s: Pick<Slot, 'imageId' | 'name' | 'source' | 'nw' | 'nh'>): MediaItem => ({
  imageId: s.imageId, name: s.name, source: clone(s.source), nw: s.nw, nh: s.nh,
});

/** The images the visible layouts show. */
const shownIds = (d: Composition) => new Set(d.slots.slice(0, d.count).map((s) => s.imageId));

/** Drops the oldest images not in a visible layout until the gallery is within MAX_MEDIA. Returns how
 *  many were dropped. */
function trim(d: Composition): number {
  const list = mediaOf(d);
  const shown = shownIds(d);
  let dropped = 0;
  while (list.length > MAX_MEDIA) {
    const k = list.findIndex((m) => !shown.has(m.imageId));
    if (k < 0) break;
    list.splice(k, 1);
    dropped++;
  }
  return dropped;
}

/** Adds images to the end of the gallery (one already there stays where it is; samples are never
 *  kept), then drops the oldest not in a visible layout to stay within MAX_MEDIA. Returns how many
 *  were dropped. */
export function addMedia(d: Composition, items: MediaItem[]): number {
  const list = mediaOf(d).slice();
  for (const it of items) {
    if (isSampleId(it.imageId) || it.source.kind === 'sample' || list.some((m) => m.imageId === it.imageId)) continue;
    list.push(mediaItemOf(it));
  }
  if (!list.length) {
    delete d.media;
    return 0;
  }
  d.media = list;
  return trim(d);
}

/** Every visible layout's image is in the gallery (canvases saved before it, layouts coming back
 *  into view). Returns how many were dropped to make room. */
export function keepShownInMedia(d: Composition): number {
  return addMedia(d, d.slots.slice(0, d.count).map(mediaItemOf));
}

/** Removes an image from the gallery, unless a visible layout shows it. Returns whether it did. */
export function removeMedia(d: Composition, id: string): boolean {
  const list = mediaOf(d);
  const k = list.findIndex((m) => m.imageId === id);
  if (k < 0 || shownIds(d).has(id)) return false;
  const next = list.filter((_, j) => j !== k);
  if (next.length) d.media = next;
  else delete d.media;
  return true;
}

/** A re-capture takes the old capture's place in the gallery, unless a visible layout still shows the
 *  old one; otherwise it's added. Returns how many were dropped to make room. */
export function replaceMedia(d: Composition, oldId: string, item: MediaItem): number {
  const list = mediaOf(d);
  const k = list.findIndex((m) => m.imageId === oldId);
  if (k < 0 || shownIds(d).has(oldId) || list.some((m) => m.imageId === item.imageId)) return addMedia(d, [item]);
  d.media = list.map((m, j) => (j === k ? mediaItemOf(item) : m));
  return 0;
}

/** Where one image goes: the target layout, else the first layout still showing a sample, else a new
 *  layout, else layout 1. */
export function slotFor(d: Composition, target: number | null): { i: number; added: boolean } {
  if (target != null && target >= 0 && target < d.count) return { i: target, added: false };
  const i = d.slots.slice(0, d.count).findIndex((s) => s.source.kind === 'sample');
  if (i >= 0) return { i, added: false };
  return d.count < 3 ? { i: d.count, added: true } : { i: 0, added: false };
}

/** Puts an image in layout i. Showcase: the page whole, as wide as the layout it replaces and from the
 *  same top edge. Classic: the crop a new image gets, no taller than the canvas allows. */
export function putImage(d: Composition, i: number, item: MediaItem): void {
  const s = d.slots[i];
  const top = s.cy - s.w / cropRatio(s) / 2;
  Object.assign(s, { imageId: item.imageId, name: item.name, source: clone(item.source), nw: item.nw, nh: item.nh, fx: 50, fy: 0 });
  if (arrangementOf(d) === 'showcase') {
    setCropOf(s, showcaseCrop);
    s.cy = top + s.w / cropRatio(s) / 2;
  } else {
    setCropOf(s, autoCrop(item.nw, item.nh));
    capHeight(s, d.H);
  }
}

/** A saved gallery, read back: well-formed images only, each once, the newest MAX_MEDIA. */
export function sanitizeMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaItem[] = [];
  for (const m of raw as Partial<MediaItem>[]) {
    if (!m || typeof m.imageId !== 'string' || !m.imageId || isSampleId(m.imageId)) continue;
    const nw = Number(m.nw), nh = Number(m.nh);
    if (!(nw > 0 && nh > 0 && Number.isFinite(nw) && Number.isFinite(nh))) continue;
    const src = m.source;
    const ok = src && (src.kind === 'file' || (src.kind === 'url' && typeof src.url === 'string' && !!src.options));
    if (!ok || out.some((o) => o.imageId === m.imageId)) continue;
    out.push({ imageId: m.imageId, name: typeof m.name === 'string' ? m.name.slice(0, 300) : '', source: clone(src), nw, nh });
  }
  return out.slice(-MAX_MEDIA);
}
