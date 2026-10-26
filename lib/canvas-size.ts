/* Switching canvas sizes keeps the work. Each size remembers where the layouts were when you left it
   (Composition.placements), and coming back restores that. A size you haven't arranged yet gets:
   - the arrangement's starting positions for its shape, when the layouts are still where arrange()
     put them (nothing of yours to keep);
   - otherwise your arrangement, scaled as one piece to fit the new canvas: edges that ran off the
     canvas still do, the others keep their share of the margins. Pure; mutates the doc it's given. */
import { arrange, arrangementOf } from './arrange';
import { setCropOf } from './crop';
import { CROPS, isArrangement, type Composition, type Placement, type PresetId, type SizePlacement } from './model';
import { rectOf } from './render/units';
import type { Measure } from './render/overlay-layout';

/** Sizes remembered per canvas, most recently left last. */
export const MAX_REMEMBERED = 8;

export const sizeKey = (W: number, H: number) => `${Math.round(W)}x${Math.round(H)}`;

const visibleOrder = (d: Pick<Composition, 'order' | 'count'>) => d.order.filter((i) => i < d.count).join();

/** A layout's placement; in grid, with its crop (the cells take the canvas's shape). */
const placementOf = ({ cx, cy, w, crop, ar }: Placement, grid: boolean): Placement =>
  grid ? { cx, cy, w, crop, ...(crop === 'custom' && ar ? { ar } : {}) } : { cx, cy, w };

export function snapshot(doc: Composition): SizePlacement {
  const arrangement = arrangementOf(doc);
  return {
    count: doc.count,
    arrangement,
    slots: doc.slots.map((s) => placementOf(s, arrangement === 'grid')) as SizePlacement['slots'],
    order: [...doc.order],
  };
}

/** Stores where the layouts are now under the doc's current size. */
export function remember(doc: Composition): void {
  const key = sizeKey(doc.W, doc.H);
  const all = { ...doc.placements };
  delete all[key];
  all[key] = snapshot(doc);
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k];
  doc.placements = all;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validPlacement = (p: unknown): p is Placement => {
  const q = p as Placement | null;
  return (
    !!q && finite(q.cx) && finite(q.cy) && finite(q.w) && q.w > 0 &&
    (q.crop === undefined || CROPS.some((c) => c.id === q.crop) || (q.crop === 'custom' && finite(q.ar) && q.ar > 0))
  );
};
function validSizePlacement(p: unknown): p is SizePlacement {
  const q = p as SizePlacement | null;
  return (
    !!q && (q.count === 1 || q.count === 2 || q.count === 3) && isArrangement(q.arrangement) &&
    Array.isArray(q.slots) && q.slots.length === 3 && q.slots.every(validPlacement) &&
    Array.isArray(q.order) && q.order.length === 3 && [0, 1, 2].every((i) => q.order.includes(i))
  );
}

/** Saved placements as read back from storage: the well-formed ones, at most MAX_REMEMBERED. */
export function sanitizePlacements(raw: unknown): Record<string, SizePlacement> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, SizePlacement> = {};
  for (const [k, v] of Object.entries(raw).slice(-MAX_REMEMBERED)) {
    if (/^\d+x\d+$/.test(k) && validSizePlacement(v)) {
      out[k] = { count: v.count, arrangement: v.arrangement, slots: v.slots.map((p) => placementOf(p, v.arrangement === 'grid')) as SizePlacement['slots'], order: [...v.order] };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** What the doc left on a W × H canvas, when it still applies (same number of layouts and same
 *  arrangement as now). */
export function recall(doc: Composition, W: number, H: number): SizePlacement | null {
  const p = doc.placements?.[sizeKey(W, H)];
  return validSizePlacement(p) && p.count === doc.count && p.arrangement === arrangementOf(doc) ? p : null;
}

export function applyPlacement(doc: Composition, p: SizePlacement): void {
  p.slots.forEach(({ cx, cy, w, crop, ar }, i) => {
    const s = doc.slots[i];
    Object.assign(s, { cx, cy, w });
    if (crop) setCropOf(s, crop, ar);
  });
  doc.order = [...p.order];
}

/** True while the visible layouts are exactly where arrange() puts them (in the same layer order). */
export function isArranged(doc: Composition, measure?: Measure | null): boolean {
  const ref: Composition = { ...doc, slots: doc.slots.map((s) => ({ ...s })) as Composition['slots'], order: [...doc.order] };
  arrange(ref, ref.count, measure);
  for (let i = 0; i < doc.count; i++) {
    const s = doc.slots[i], r = ref.slots[i];
    if (s.cx !== r.cx || s.cy !== r.cy || s.w !== r.w) return false;
  }
  return visibleOrder(doc) === visibleOrder(ref);
}

/** One axis of fit(): where a canvas coordinate goes. The group spans [lo, hi] on a canvas `from`
 *  long; it is scaled by k about an anchor that keeps its share of the new length `to`. */
function axisMap(lo: number, hi: number, from: number, to: number, k: number): (v: number) => number {
  const offStart = lo < 0, offEnd = hi > from;
  // Running off one end only: the edge on the canvas keeps its margin (as a share of the length),
  // and the group goes on running off the other end.
  if (offEnd && !offStart) return (v) => (lo / from) * to + (v - lo) * k;
  if (offStart && !offEnd) return (v) => (hi / from) * to + (v - hi) * k;
  // On the canvas (or off both ends): the middle of what shows keeps its place.
  const c = (Math.max(lo, 0) + Math.min(hi, from)) / 2;
  return (v) => (c / from) * to + (v - c) * k;
}

/** The visible layouts scaled as one piece from the doc's canvas onto W × H (the doc's own size is
 *  left to the caller): by the smaller of the two size ratios, so the arrangement keeps its
 *  proportions and fits. */
export function fit(doc: Composition, W: number, H: number): void {
  const k = Math.min(W / doc.W, H / doc.H);
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (let i = 0; i < doc.count; i++) {
    const q = rectOf(doc.slots[i]);
    l = Math.min(l, q.l); t = Math.min(t, q.t); r = Math.max(r, q.l + q.w); b = Math.max(b, q.t + q.h);
  }
  const mx = axisMap(l, r, doc.W, W, k), my = axisMap(t, b, doc.H, H, k);
  for (const s of doc.slots) {
    s.cx = mx(s.cx);
    s.cy = my(s.cy);
    s.w *= k;
  }
}

export type ResizeResult = 'same' | 'restored' | 'arranged' | 'fitted';

/** Moves the doc onto a W × H canvas (of `preset`, which the headline's layout depends on),
 *  keeping the work (see the top of this file). */
export function resizeCanvas(doc: Composition, W: number, H: number, measure?: Measure | null, preset: PresetId = doc.preset): ResizeResult {
  if (doc.W === W && doc.H === H) {
    doc.preset = preset;
    return 'same';
  }
  const fresh = isArranged(doc, measure);
  remember(doc);
  doc.preset = preset;
  const saved = recall(doc, W, H);
  let result: ResizeResult;
  if (saved) {
    applyPlacement(doc, saved);
    result = 'restored';
  } else if (fresh) {
    result = 'arranged';
  } else {
    fit(doc, W, H);
    result = 'fitted';
  }
  doc.W = W;
  doc.H = H;
  if (result === 'arranged') arrange(doc, doc.count, measure);
  return result;
}
