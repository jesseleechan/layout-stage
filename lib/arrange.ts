/* Starting positions for 1–3 images. These are starting points, not preset layouts:
   everything stays freely draggable. */
import { applyStyleTo, defaultBackground, sampleSlot, STYLES, clone, type Composition } from './model';
import { cropRatio } from './render/units';

type Spot = [fx: number, fy: number, fw: number];
const SPOTS: Record<'port' | 'sq' | 'land', Record<1 | 2 | 3, Spot[]>> = {
  port: { 1: [[0.5, 0.5, 0.84]], 2: [[0.4, 0.37, 0.78], [0.6, 0.63, 0.78]], 3: [[0.38, 0.24, 0.72], [0.5, 0.5, 0.72], [0.62, 0.76, 0.72]] },
  sq: { 1: [[0.5, 0.5, 0.8]], 2: [[0.38, 0.38, 0.66], [0.62, 0.62, 0.66]], 3: [[0.5, 0.6, 0.62], [0.3, 0.37, 0.5], [0.7, 0.37, 0.5]] },
  land: { 1: [[0.5, 0.5, 0.7]], 2: [[0.27, 0.5, 0.42], [0.73, 0.5, 0.42]], 3: [[0.5, 0.57, 0.52], [0.24, 0.42, 0.4], [0.76, 0.42, 0.4]] },
};

export function canvasKind(W: number, H: number): 'port' | 'sq' | 'land' {
  const ar = W / H;
  return ar > 1.1 ? 'land' : ar > 0.9 ? 'sq' : 'port';
}

/** Places the first n slots at their starting positions and resets the z-order. Mutates `doc`. */
export function arrange(doc: Composition, n: 1 | 2 | 3 = doc.count): void {
  const { W, H } = doc;
  const kind = canvasKind(W, H);
  SPOTS[kind][n].forEach(([fx, fy, fw], i) => {
    const s = doc.slots[i];
    let w = fw * W;
    const r = cropRatio(s);
    const maxH = H * (n === 1 ? 0.86 : n === 2 ? 0.6 : 0.48);
    if (w / r > maxH) w = maxH * r;
    s.w = Math.round(w);
    s.cx = Math.round(fx * W);
    s.cy = Math.round(fy * H);
  });
  // On square and landscape canvases the 3-up is a hero with two behind it.
  const vis = kind !== 'port' && n === 3 ? [1, 2, 0] : Array.from({ length: n }, (_, i) => i);
  doc.order = [...vis, ...[0, 1, 2].filter((i) => !vis.includes(i))];
}

/** The first-run canvas: a Pinterest pin with two sample sites in the Blush mesh style. */
export function defaultComposition(): Composition {
  const doc: Composition = {
    preset: 'pin', W: 1000, H: 1500, count: 2,
    slots: [sampleSlot(0), sampleSlot(1), sampleSlot(2)],
    order: [0, 1, 2],
    frame: clone(STYLES[0].frame),
    background: defaultBackground(),
  };
  applyStyleTo(doc, STYLES[0]);
  arrange(doc);
  return doc;
}
