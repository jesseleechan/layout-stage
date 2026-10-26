/* Pin variations: several takes on the canvas from the same pages, so one template can go out as
   several fresh pins. Each takes the canvas (size, frame, everything else) and changes three things:
   the layout (Scroll, Columns, Editorial, one long page across two columns, Inset, Bento),
   which page leads (the pages in Media, rotated), and the background (the canvas's own, or one made
   from the site's colors as Match site colors makes them). Pure: the export renders them, and any one
   can be put on the canvas. */
import { applyArrangement, arrange, ARRANGEMENT_NAMES, canContinuePage, showFirstPage } from './arrange';
import { mediaItemOf, mediaOf, putImage } from './media';
import { clone, type Arrangement, type Background, type Composition } from './model';
import { variantPatch, type SiteBackgrounds } from './palette';
import type { Measure } from './render/overlay-layout';

type BgPick = 'current' | 'mesh' | 'gradient' | 'solid' | 'moved';

interface Recipe {
  count: 1 | 2 | 3;
  arrangement: Arrangement;
  /** Which page leads (an index into the pages, wrapping). */
  lead: number;
  bg: BgPick;
  /** Two showcase columns showing one long page, when the lead page is long enough; otherwise two
   *  columns led by this page instead, so the take still differs from the first. */
  continued?: number;
}

const RECIPES: Recipe[] = [
  { count: 2, arrangement: 'showcase', lead: 0, bg: 'current' },
  { count: 1, arrangement: 'showcase', lead: 1, bg: 'mesh' },
  { count: 3, arrangement: 'showcase', lead: 2, bg: 'gradient' },
  { count: 2, arrangement: 'showcase', lead: 0, bg: 'solid', continued: 2 },
  { count: 2, arrangement: 'spotlight', lead: 3, bg: 'moved' },
  { count: 3, arrangement: 'grid', lead: 4, bg: 'current' },
];

export interface Variation {
  key: string;
  label: string;
  doc: Composition;
}

/** The background for a pick: from the site's colors when there are some, else the canvas's own
 *  (its mesh moved, for the picks that need a change). Grain and texture stay. */
function background(bg: Background, pick: BgPick, site: SiteBackgrounds | null): { patch: Partial<Background>; label: string } {
  if (pick === 'current') return { patch: {}, label: 'your background' };
  if (pick === 'moved' || !site) {
    const mesh = site ? site.mesh : bg.mesh;
    return { patch: { type: 'mesh', mesh: [...mesh], meshSeed: bg.meshSeed + 3 }, label: site ? 'site mesh, moved' : 'mesh, moved' };
  }
  return { patch: variantPatch(site, pick), label: { mesh: 'site mesh', gradient: 'site gradient', solid: 'site color' }[pick] };
}

/** The pages to vary: Media, else (nothing added yet) the layouts on the canvas. */
export const variationPages = (d: Composition) => (mediaOf(d).length ? mediaOf(d) : d.slots.slice(0, d.count).map(mediaItemOf));

/** Up to six variations of `src`, each different; `site` is the lead page's site backgrounds
 *  (lib/palette.ts siteBackgrounds), or null when its colors couldn't be read. */
export function pinVariations(src: Composition, site: SiteBackgrounds | null, measure?: Measure | null): Variation[] {
  const pages = variationPages(src);
  if (!pages.length) return [];
  const out: Variation[] = [];
  const seen = new Set<string>();
  for (const r of RECIPES) {
    const n = Math.min(r.count, pages.length) as 1 | 2 | 3;
    const take = (lead: number) => {
      const d = clone(src);
      d.count = n;
      d.arrangement = r.arrangement;
      for (let j = 0; j < n; j++) putImage(d, j, pages[(lead + j) % pages.length]);
      applyArrangement(d, r.arrangement, measure);
      return d;
    };
    let d = take(r.lead);
    let name = ARRANGEMENT_NAMES[r.arrangement][n];
    if (r.continued != null) {
      if (canContinuePage(d, measure)) {
        showFirstPage(d, 1);
        arrange(d, 2, measure);
        name = 'One page';
      } else d = take(r.continued);
    }
    const bg = background(d.background, r.bg, site);
    Object.assign(d.background, clone(bg.patch));
    const sig = JSON.stringify([d.count, d.arrangement, name, d.slots.slice(0, n).map((s) => s.imageId), d.background]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ key: `variation-${out.length + 1}`, label: `${name} · ${bg.label}`, doc: d });
  }
  return out;
}
