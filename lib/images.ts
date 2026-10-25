/* Image blob store. Blobs live once in IndexedDB (with an in-memory copy, which is also the fallback
   when the browser blocks storage); compositions point at them by id. Display uses object URLs,
   created lazily and revoked when an image is no longer on the canvas. Browser only. */
import { useEffect, useSyncExternalStore } from 'react';
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import { isSampleId } from './model';
import { drawSample, type SampleId } from './samples';

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

interface Entry {
  url: string;
  img: HTMLImageElement | null;
  p: Promise<HTMLImageElement | null>;
}
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((f) => f());
}

const newId = () =>
  'img_' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Stores a blob and returns its id. */
export async function putImage(blob: Blob): Promise<string> {
  const id = newId();
  blobs.set(id, blob);
  try {
    const s = db();
    if (s) await set(id, blob, s);
  } catch {
    /* storage blocked or full: the in-memory copy still works for this session */
  }
  return id;
}

async function getBlob(id: string): Promise<Blob | null> {
  const hit = blobs.get(id);
  if (hit) return hit;
  if (isSampleId(id)) {
    const c = drawSample(id as SampleId);
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

/** Revokes the object URL (the blob stays stored, so undo can bring the image back). */
export function releaseImage(id: string | null | undefined): void {
  if (!id || isSampleId(id)) return;
  const e = entries.get(id);
  if (!e) return;
  entries.delete(id);
  if (e.url) URL.revokeObjectURL(e.url);
  emit();
}

/** Deletes stored blobs that are not in `keep`. Run at startup, after the saved canvas is restored. */
export async function pruneImages(keep: Set<string>): Promise<void> {
  for (const id of Array.from(blobs.keys())) if (!keep.has(id) && !isSampleId(id)) blobs.delete(id);
  try {
    const s = db();
    if (!s) return;
    const all = (await keys(s)) as string[];
    await Promise.all(all.filter((id) => !keep.has(id)).map((id) => del(id, s)));
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
