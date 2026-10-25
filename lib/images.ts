/* Image blob store. Blobs live once in IndexedDB (with an in-memory copy, which is also the fallback
   when the browser blocks storage); compositions point at them by id. Display uses object URLs,
   created lazily and revoked when an image is no longer on the canvas. Browser only.

   Big images are made cheap where they come in (ingestImage): one over the storage budget
   (lib/image-sizing.ts) is stored as a downscaled copy instead of the original. Every image also gets
   a small thumbnail, stored beside it under `thumb:<id>`, so the panels never decode a full image;
   images stored before thumbnails existed (and the samples) get theirs on first use. */
import { useEffect, useSyncExternalStore } from 'react';
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { isSampleId } from './model';
import { drawSample, type SampleId } from './samples';
import { downscaleSteps, IOS_CANVAS_MAX_PX, STORE_BUDGET, storedSize, thumbPlan, type Size } from './image-sizing';

let idb: UseStore | null = null;
function db(): UseStore | null {
  if (!idb && typeof indexedDB !== 'undefined') {
    try {
      idb = createStore('layout-stage-images', 'images');
    } catch {
      idb = null;
    }
  }
  return idb;
}

const blobs = new Map<string, Blob>();
/** Ids stored during this session: never pruned (an upload can land while the startup prune runs). */
const fresh = new Set<string>();

interface Entry {
  url: string;
  img: HTMLImageElement | null;
  p: Promise<HTMLImageElement | null>;
}
const entries = new Map<string, Entry>();

/** Thumbnails, stored beside their image under `thumb:<id>`. */
const THUMB = 'thumb:';
const thumbBlobs = new Map<string, Blob>();
/** Thumbnails being read or made, so each is made once. */
const thumbJobs = new Map<string, Promise<Blob | null>>();
interface ThumbEntry {
  url: string;
  p: Promise<string | null>;
}
const thumbs = new Map<string, ThumbEntry>();

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((f) => f());
}

const newId = () =>
  'img_' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

async function save(key: string, blob: Blob): Promise<void> {
  try {
    const s = db();
    if (s) await set(key, blob, s);
  } catch {
    /* storage blocked or full: the in-memory copy still works for this session */
  }
}

/** Stores a blob as it is and returns its id. */
export async function putImage(blob: Blob): Promise<string> {
  const id = newId();
  fresh.add(id);
  blobs.set(id, blob);
  await save(id, blob);
  return id;
}

async function getBlob(id: string): Promise<Blob | null> {
  const hit = blobs.get(id);
  if (hit) return hit;
  if (isSampleId(id)) {
    const c = await drawSample(id as SampleId);
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (b) blobs.set(id, b);
    return b;
  }
  try {
    const s = db();
    const v = s ? await get(id, s) : undefined;
    if (v instanceof Blob) {
      blobs.set(id, v);
      return v;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Returns the stored blob for an id (e.g. to re-use an image elsewhere). */
export function getImageBlob(id: string): Promise<Blob | null> {
  return getBlob(id);
}

/** Loads an image element. Resolves once its size is known; browsers decode the pixels on first draw. */
function decode(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img.naturalWidth ? img : null);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** Loads (once) and decodes an image by id. Resolves null when it can't be read. */
export function loadImage(id: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!id) return Promise.resolve(null);
  const hit = entries.get(id);
  if (hit) return hit.p;
  const entry: Entry = { url: '', img: null, p: Promise.resolve(null) };
  entry.p = (async () => {
    const blob = await getBlob(id);
    if (!blob || entries.get(id) !== entry) return null;
    entry.url = URL.createObjectURL(blob);
    const img = await decode(entry.url);
    if (entries.get(id) !== entry) return img;
    if (!img) {
      URL.revokeObjectURL(entry.url);
      entries.delete(id);
      return null;
    }
    entry.img = img;
    emit();
    return img;
  })();
  entries.set(id, entry);
  return entry.p;
}

/** The decoded image, if it has finished loading. */
export function getLoadedImage(id: string | null | undefined): HTMLImageElement | null {
  return (id && entries.get(id)?.img) || null;
}

/** The object URL, once the image has finished loading. */
export function getImageUrl(id: string | null | undefined): string | null {
  const e = id ? entries.get(id) : undefined;
  return e && e.img ? e.url : null;
}

/** Revokes the object URLs of an image and its thumbnail and drops the decoded image (the blobs stay
 *  stored, so undo can bring the image back). */
export function releaseImage(id: string | null | undefined): void {
  if (!id || isSampleId(id)) return;
  const e = entries.get(id);
  const t = thumbs.get(id);
  if (!e && !t) return;
  entries.delete(id);
  if (e?.url) URL.revokeObjectURL(e.url);
  thumbs.delete(id);
  if (t?.url) URL.revokeObjectURL(t.url);
  emit();
}

/** Deletes stored blobs (and thumbnails) that are not in `keep`. Run at startup, after the saved canvas is restored. */
export async function pruneImages(keep: Set<string>): Promise<void> {
  const drop = (id: string) => !keep.has(id) && !fresh.has(id) && !isSampleId(id);
  for (const id of Array.from(blobs.keys())) if (drop(id)) blobs.delete(id);
  for (const id of Array.from(thumbBlobs.keys())) if (drop(id)) thumbBlobs.delete(id);
  try {
    const s = db();
    if (!s) return;
    const all = (await keys(s)) as string[];
    await Promise.all(all.filter((k) => drop(k.startsWith(THUMB) ? k.slice(THUMB.length) : k)).map((k) => del(k, s)));
  } catch {
    /* ignore */
  }
}

export function subscribeImages(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React: the object URL for an image id (null until loaded). Starts the load. */
export function useImageUrl(id: string | null | undefined): string | null {
  useSyncExternalStore(subscribeImages, () => version, () => 0);
  const known = !!id && entries.has(id);
  useEffect(() => {
    if (id && !known) void loadImage(id);
  }, [id, known]);
  return getImageUrl(id);
}

/** React: the decoded image for an id (null until loaded). Starts the load. */
export function useLoadedImage(id: string | null | undefined): HTMLImageElement | null {
  useSyncExternalStore(subscribeImages, () => version, () => 0);
  const known = !!id && entries.has(id);
  useEffect(() => {
    if (id && !known) void loadImage(id);
  }, [id, known]);
  return getLoadedImage(id);
}

/* ---------------- drawing: downscales and thumbnails ---------------- */

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A w × h 2D canvas, offscreen when the browser has OffscreenCanvas. Null when the browser can't make
 *  one that big: iOS Safari hands back a canvas over 16.7 MP that silently draws nothing, so a big one
 *  is checked by reading back a test pixel. */
function makeCanvas(w: number, h: number): [Canvas, Ctx] | null {
  try {
    let c: Canvas;
    if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
    else {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
    }
    const x = c.getContext('2d') as Ctx | null;
    if (!x) return null;
    if (w * h > IOS_CANVAS_MAX_PX) {
      x.fillStyle = '#000';
      x.fillRect(w - 1, h - 1, 1, 1);
      if (x.getImageData(w - 1, h - 1, 1, 1).data[3] !== 255) {
        freeCanvas(c);
        return null;
      }
      x.clearRect(w - 1, h - 1, 1, 1);
    }
    return [c, x];
  } catch {
    return null;
  }
}

/** Gives a canvas's memory back now (Safari otherwise holds it until garbage collection). */
function freeCanvas(c: Canvas): void {
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    /* ignore */
  }
}

/** Draws the (sx, sy, sw, sh) part of `src` onto a new w × h canvas: halving in steps, each drawn with
 *  imageSmoothingQuality 'high', for a clean downscale. Null when the target canvas can't be made. */
function drawScaled(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number): Canvas | null {
  const steps = downscaleSteps(sw, sh, w, h);
  let cur: { src: CanvasImageSource; c: Canvas | null; x: number; y: number; w: number; h: number } = { src, c: null, x: sx, y: sy, w: sw, h: sh };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const made = makeCanvas(s.w, s.h);
    if (!made) {
      if (i < steps.length - 1) continue; // skip an intermediate the browser can't hold
      if (cur.c) freeCanvas(cur.c);
      return null;
    }
    const [c, x] = made;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur.src, cur.x, cur.y, cur.w, cur.h, 0, 0, s.w, s.h);
    if (cur.c) freeCanvas(cur.c);
    cur = { src: c, c, x: 0, y: 0, w: s.w, h: s.h };
  }
  return cur.c;
}

async function encode(c: Canvas, type: string, quality?: number): Promise<Blob | null> {
  try {
    if ('convertToBlob' in c) return await c.convertToBlob({ type, quality });
    return await new Promise<Blob | null>((res) => c.toBlob(res, type, quality));
  } catch {
    return null;
  }
}

/** A thumbnail of an image (see thumbPlan): WebP where the browser encodes it, else PNG. */
async function thumbOf(src: CanvasImageSource, nw: number, nh: number): Promise<Blob | null> {
  const t = thumbPlan(nw, nh);
  const c = drawScaled(src, t.sx, t.sy, t.sw, t.sh, t.w, t.h);
  if (!c) return null;
  const b = await encode(c, 'image/webp', 0.9);
  freeCanvas(c);
  return b;
}

/** The image fully decoded for drawing: an ImageBitmap where the browser can make one (decoded off the
 *  main thread, and freed at once by `done`), else the loaded image element (decoded on first draw).
 *  The bitmap is only used when its size matches the element's, i.e. it applied the same orientation. */
async function decodeFull(blob: Blob, img: HTMLImageElement | null): Promise<{ src: CanvasImageSource; w: number; h: number; done(): void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      if (!img || (bm.width === img.naturalWidth && bm.height === img.naturalHeight)) return { src: bm, w: bm.width, h: bm.height, done: () => bm.close() };
      bm.close();
    } catch {
      /* option or format not supported: use the element */
    }
  }
  if (img) return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => {} };
  const url = URL.createObjectURL(blob);
  const el = await decode(url);
  URL.revokeObjectURL(url);
  return el && { src: el, w: el.naturalWidth, h: el.naturalHeight, done: () => {} };
}

/** Draws the image at its stored size. Null when the browser can't make a canvas that big. */
async function drawStored(blob: Blob, img: HTMLImageElement, to: Size): Promise<Canvas | null> {
  const full = await decodeFull(blob, img);
  if (!full) return null;
  try {
    const c = drawScaled(full.src, 0, 0, full.w, full.h, to.w, to.h);
    if (c) return c;
    // iOS Safari: no canvas over 16.7 MP, so the copy has to fit in that.
    const ios = storedSize(full.w, full.h, { ...STORE_BUDGET, maxPx: Math.min(STORE_BUDGET.maxPx, IOS_CANVAS_MAX_PX) });
    return ios.w * ios.h < to.w * to.h ? drawScaled(full.src, 0, 0, full.w, full.h, ios.w, ios.h) : null;
  } finally {
    full.done();
  }
}

/* The downscaled copy's format. Screenshots stay lossless: PNG, about half the bytes of the original
   at half the pixels. Lossy WebP (q 0.92) would be another 3–6× smaller, but measured on a 1965 × 16,383
   copy it visibly dulls thin colored text (4:2:0 chroma: a quarter of the strongly red pixels of red
   text lost their color) and takes 2–4 s to encode against PNG's 0.3–1 s; Chrome's lossless WebP came
   out bigger than PNG. A JPEG is a photo, already lossy and opaque: JPEG q 0.92. */
function encodeCopy(c: Canvas, original: Blob): Promise<Blob | null> {
  return original.type === 'image/jpeg' ? encode(c, 'image/jpeg', 0.92) : encode(c, 'image/png');
}

/* ---------------- ingest ---------------- */

export interface StoredImage {
  id: string;
  /** Natural size of the stored image. */
  nw: number;
  nh: number;
}

/** Stores an incoming image (upload, drop, paste, capture) with its thumbnail, decoded and ready to show.
 *  An image within the storage budget is stored byte for byte; a bigger one as a proportionally
 *  downscaled copy, so nw × nh is the stored size. Resolves null when the image can't be read. */
export async function ingestImage(blob: Blob): Promise<StoredImage | null> {
  const url = URL.createObjectURL(blob);
  const img = await decode(url);
  if (!img) {
    URL.revokeObjectURL(url);
    return null;
  }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const to = storedSize(nw, nh);
  if (to.scaled) {
    const c = await drawStored(blob, img, to);
    const copy = c && (await encodeCopy(c, blob));
    if (c && copy) {
      URL.revokeObjectURL(url);
      const thumb = await thumbOf(c, c.width, c.height);
      freeCanvas(c);
      const id = await putImage(copy);
      if (thumb) {
        thumbBlobs.set(id, thumb);
        await save(THUMB + id, thumb);
      }
      const el = await loadImage(id);
      return el && { id, nw: el.naturalWidth, nh: el.naturalHeight };
    }
    // Couldn't make the smaller copy: keep the original, as before.
    if (c) freeCanvas(c);
  }
  const id = await putImage(blob);
  entries.set(id, { url, img, p: Promise.resolve(img) });
  emit();
  // The thumbnail needs a full decode: it's made in the background, and a panel asking for it waits.
  trackThumb(id, makeThumb(id, blob, img));
  return { id, nw, nh };
}

/* ---------------- thumbnails ---------------- */

/** Makes an image's thumbnail and stores it beside the image (not for samples, which may be drawn
 *  differently later). Decodes the image once, off the main thread where the browser can. */
async function makeThumb(id: string, blob: Blob, img: HTMLImageElement | null): Promise<Blob | null> {
  const full = await decodeFull(blob, img);
  if (!full) return null;
  let t: Blob | null;
  try {
    t = await thumbOf(full.src, full.w, full.h);
  } finally {
    full.done();
  }
  if (t && !isSampleId(id)) await save(THUMB + id, t);
  return t;
}

/** Keeps a thumbnail in memory once its job is done; until then, askers share the job. */
function trackThumb(id: string, job: Promise<Blob | null>): Promise<Blob | null> {
  const p = job
    .catch(() => null)
    .then((b) => {
      if (b) thumbBlobs.set(id, b);
      thumbJobs.delete(id);
      return b;
    });
  thumbJobs.set(id, p);
  return p;
}

/** The thumbnail blob: from memory, from IndexedDB, or made now (samples, and images stored before
 *  thumbnails existed: once per image, since it's stored). */
function getThumbBlob(id: string): Promise<Blob | null> {
  const hit = thumbBlobs.get(id);
  if (hit) return Promise.resolve(hit);
  const job = thumbJobs.get(id);
  if (job) return job;
  return trackThumb(
    id,
    (async () => {
      if (!isSampleId(id)) {
        try {
          const s = db();
          const v = s ? await get(THUMB + id, s) : undefined;
          if (v instanceof Blob) return v;
        } catch {
          /* make it */
        }
      }
      const blob = await getBlob(id);
      return blob && makeThumb(id, blob, null);
    })(),
  );
}

function loadThumb(id: string): Promise<string | null> {
  const hit = thumbs.get(id);
  if (hit) return hit.p;
  const entry: ThumbEntry = { url: '', p: Promise.resolve(null) };
  entry.p = (async () => {
    const blob = await getThumbBlob(id);
    if (!blob || thumbs.get(id) !== entry) return null;
    entry.url = URL.createObjectURL(blob);
    emit();
    return entry.url;
  })();
  thumbs.set(id, entry);
  return entry.p;
}

/** React: the object URL of an image's thumbnail (null until ready). Never loads the full image. */
export function useThumbUrl(id: string | null | undefined): string | null {
  useSyncExternalStore(subscribeImages, () => version, () => 0);
  const known = !!id && thumbs.has(id);
  useEffect(() => {
    if (id && !known) void loadThumb(id);
  }, [id, known]);
  return (id && thumbs.get(id)?.url) || null;
}

/* ---------------- projects: images from another device (lib/projects) ---------------- */

/** Whether an image's blob is on this device (samples always are: they're drawn). */
export async function hasImage(id: string): Promise<boolean> {
  if (blobs.has(id) || isSampleId(id)) return true;
  try {
    const s = db();
    return !!s && (await get(id, s)) instanceof Blob;
  } catch {
    return false;
  }
}

/** Stores a downloaded image under its own id, as it was stored on the device that added it. Its
 *  thumbnail is made on first use. An earlier failed load of the id is forgotten, so it loads now. */
export async function storeImage(id: string, blob: Blob): Promise<void> {
  fresh.add(id);
  blobs.set(id, blob);
  await save(id, blob);
  const e = entries.get(id);
  if (e && !e.img) entries.delete(id);
  const t = thumbs.get(id);
  if (t && !t.url) thumbs.delete(id);
  emit();
}
