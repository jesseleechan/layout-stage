/* The overlay fonts (lib/overlays.ts): loaded once each with the FontFace API, and the canvas text
   measure the overlay layout uses. The preview repaints when a face arrives (subscribeFonts); the
   export awaits loadOverlayFonts before it draws. Browser only. */
import type { Composition } from '../model';
import { allFaces, faceFile, facesFor, OVERLAY_FONTS, type OverlayFace } from '../overlays';
import type { Measure } from './overlay-layout';

/** How long text waits for its font before drawing with the fallbacks in the stack. */
const FONT_WAIT_MS = 10_000;

const loads = new Map<string, Promise<void>>();
const settled = new Set<string>(); // loaded, failed or timed out: ready to draw
const listeners = new Set<() => void>();
let version = 0;
const keyOf = (f: OverlayFace) => `${f.font}:${f.weight}:${f.style}`;

/** Measurements change when a face arrives: forget them and tell the preview. */
function changed() {
  measured.clear();
  version++;
  listeners.forEach((fn) => fn());
}

/** Loads one face (once). Never rejects; a face that fails is left out, so the fallbacks draw. */
export function loadFace(f: OverlayFace): Promise<void> {
  const k = keyOf(f);
  let p = loads.get(k);
  if (!p) {
    const settle = () => {
      if (!settled.has(k)) { settled.add(k); changed(); }
    };
    const load = (async () => {
      try {
        const face = new FontFace(OVERLAY_FONTS[f.font].family, `url(${faceFile(f)}) format("woff2")`, { weight: String(f.weight), style: f.style });
        document.fonts.add(await face.load());
        if (settled.has(k)) changed(); // arrived after the wait ran out: redraw with it
      } catch {
        /* missing or blocked: the fallback fonts draw this text */
      }
    })();
    p = Promise.race([load, new Promise<void>((res) => setTimeout(res, FONT_WAIT_MS))]).then(settle);
    loads.set(k, p);
  }
  return p;
}

export const faceReady = (f: OverlayFace) => settled.has(keyOf(f));

/** Loads the faces the composition's enabled overlays draw with. */
export function loadOverlayFonts(doc: Pick<Composition, 'overlays'>): Promise<void> {
  return Promise.all(facesFor(doc).map(loadFace)).then(() => undefined);
}

export const overlayFontsReady = (doc: Pick<Composition, 'overlays'>) => facesFor(doc).every(faceReady);

/** Every bundled face (the panel's font picker shows each name in its own face). */
export function loadAllOverlayFonts(): Promise<void> {
  return Promise.all(allFaces().map(loadFace)).then(() => undefined);
}

export function subscribeFonts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const fontsVersion = () => version;

/* ---------------- measuring ---------------- */

const measured = new Map<string, number>();
let mctx: CanvasRenderingContext2D | null = null;

/** Canvas text width, cached. The layout only ever asks at REF_PX. */
export const canvasMeasure: Measure = (text, font) => {
  const k = font + '\n' + text;
  let w = measured.get(k);
  if (w == null) {
    mctx ??= document.createElement('canvas').getContext('2d');
    if (!mctx) return 0;
    mctx.font = font;
    w = mctx.measureText(text).width;
    if (measured.size > 4000) measured.clear();
    measured.set(k, w);
  }
  return w;
};
