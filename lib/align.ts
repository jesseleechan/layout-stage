/* Align and distribute the visible layouts. Positions are canvas px. Both mutate the doc and return
   whether anything moved (moves under 1e-6 px are skipped, so a second click changes nothing).

   - Align: the reference is the selected layout, which stays put; every other visible layout moves
     so its left / center / right edge (or top / middle / bottom) lines up with the reference's.
     Needs at least 2 visible layouts.
   - Distribute: the visible layouts are ordered by their centers along the axis; the first and the
     last stay put and the ones between move so every gap (next start − previous end) is equal.
     Overlapping layouts get equal overlaps (negative gaps). Needs at least 3 visible layouts. */
import type { Composition } from './model';
import { rectOf } from './render/units';

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

const EPS = 1e-6;

export const canAlign = (doc: Pick<Composition, 'count'>) => doc.count >= 2;
export const canDistribute = (doc: Pick<Composition, 'count'>) => doc.count >= 3;

/** Moves the other visible layouts to the reference layout `ref`. */
export function alignLayouts(doc: Composition, ref: number, edge: AlignEdge): boolean {
  if (!canAlign(doc) || ref < 0 || ref >= doc.count) return false;
  const R = rectOf(doc.slots[ref]);
  let moved = false;
  for (let j = 0; j < doc.count; j++) {
    if (j === ref) continue;
    const s = doc.slots[j];
    const r = rectOf(s);
    const horizontal = edge === 'left' || edge === 'center' || edge === 'right';
    const c =
      edge === 'left' ? R.l + r.w / 2
      : edge === 'center' ? R.l + R.w / 2
      : edge === 'right' ? R.l + R.w - r.w / 2
      : edge === 'top' ? R.t + r.h / 2
      : edge === 'middle' ? R.t + R.h / 2
      : R.t + R.h - r.h / 2;
    const key = horizontal ? 'cx' : 'cy';
    if (Math.abs(s[key] - c) > EPS) {
      s[key] = c;
      moved = true;
    }
  }
  return moved;
}

/** Equal gaps between the visible layouts along an axis ('h': left to right, 'v': top to bottom). */
export function distributeLayouts(doc: Composition, axis: 'h' | 'v'): boolean {
  if (!canDistribute(doc)) return false;
  const items = Array.from({ length: doc.count }, (_, j) => {
    const r = rectOf(doc.slots[j]);
    return axis === 'h' ? { j, a: r.l, size: r.w } : { j, a: r.t, size: r.h };
  });
  items.sort((p, q) => p.a + p.size / 2 - (q.a + q.size / 2) || p.j - q.j);
  const first = items[0], last = items[items.length - 1], inner = items.slice(1, -1);
  const gap = (last.a - (first.a + first.size) - inner.reduce((t, it) => t + it.size, 0)) / (items.length - 1);
  const key = axis === 'h' ? 'cx' : 'cy';
  let pos = first.a + first.size + gap, moved = false;
  for (const it of inner) {
    const s = doc.slots[it.j];
    const c = pos + it.size / 2;
    if (Math.abs(s[key] - c) > EPS) {
      s[key] = c;
      moved = true;
    }
    pos += it.size + gap;
  }
  return moved;
}
