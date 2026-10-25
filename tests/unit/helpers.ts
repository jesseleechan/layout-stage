/* Shared test fixtures. */
import { arrange, defaultComposition } from '@/lib/arrange';
import type { Composition } from '@/lib/model';

/** The first-run canvas arranged the classic way (the prototype's cascades, the samples at 16:10),
 *  as it was before the showcase arrangements; most canvas tests are written against it. */
export function classicComposition(): Composition {
  const d = defaultComposition();
  d.arrangement = 'classic';
  for (const s of d.slots) s.crop = '16:10';
  arrange(d);
  return d;
}
