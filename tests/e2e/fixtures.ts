/* Fixed compositions for the golden export test (tests/e2e/golden.spec.ts). Every value is written
   out here, not derived from arrange() or the built-in styles, so a change to the app's defaults
   never silently changes what the goldens draw. */
import type { Background, Composition, CropId, PresetId, Slot } from '../../lib/model';

/** Placeholder id for the wide (2880 × 2560) image the test builds in the page from two samples, so
 *  a horizontal Pan (fx) can be exercised: the samples themselves are 9:16 and never pan. */
export const WIDE_ID = 'fixture:wide';

type Sample = 'juniper' | 'northbeam' | 'fieldnote';
const NAMES: Record<Sample, string> = { juniper: 'Juniper & Co.', northbeam: 'Northbeam', fieldnote: 'Fieldnote Coffee' };

function sample(id: Sample, crop: CropId, pos: Pick<Slot, 'cx' | 'cy' | 'w'>, f: Partial<Pick<Slot, 'fx' | 'fy'>> = {}): Slot {
  return { imageId: `sample:${id}`, name: NAMES[id], source: { kind: 'sample' }, nw: 1440, nh: 2560, crop, fx: 50, fy: 0, ...f, ...pos };
}

function wide(crop: CropId, pos: Pick<Slot, 'cx' | 'cy' | 'w'>, fx: number): Slot {
  return { imageId: WIDE_ID, name: 'Juniper + Fieldnote', source: { kind: 'file' }, nw: 2880, nh: 2560, crop, fx, fy: 0, ...pos };
}

/** Filler for slots past `count`, which are never drawn. */
const spare = (): Slot => sample('fieldnote', '16:10', { cx: 500, cy: 750, w: 700 });

function background(patch: Partial<Background>): Background {
  return {
    type: 'solid', solid: '#F5F5F2', grad: { a: '#FFE6C7', b: '#FF9A8B', angle: 160 }, mesh: ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'],
    meshSeed: 3, imageId: null, imageName: '', blur: 0, dim: 0, grain: 0, texture: 0, ...patch,
  };
}

export interface GoldenCase {
  /** Golden file name without .png; the preset id when absent. */
  name?: string;
  preset: PresetId;
  doc: Composition;
  /** null: the real export path, exportComposition(doc, 'png', 1). A number: renderComposition(doc, m),
   *  the same drawing code at a smaller output scale, to keep the big Etsy goldens small. */
  m: number | null;
  /** Expected output size in px. */
  size: [number, number];
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    // Pinterest pin, portrait 3-up cascade. Mesh with grain, Lifted shadow, no border, a scrolled crop.
    preset: 'pin',
    m: null,
    size: [1000, 1500],
    doc: {
      preset: 'pin', W: 1000, H: 1500, count: 3,
      slots: [
        sample('juniper', '16:10', { cx: 380, cy: 360, w: 720 }),
        sample('northbeam', '16:10', { cx: 500, cy: 750, w: 720 }, { fy: 45 }),
        sample('fieldnote', '4:5', { cx: 650, cy: 1120, w: 480 }, { fy: 30 }),
      ],
      order: [0, 2, 1],
      frame: { radius: 14, borderW: 0, borderC: '#FFFFFF', bar: 'none', shadow: { preset: 'lifted', blur: 80, x: 0, y: 40, opacity: 0.28, color: '#4A2533' } },
      background: background({ type: 'mesh', mesh: ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'], meshSeed: 3, grain: 10 }),
    },
  },
  {
    // Etsy 4:3, hero with two behind. Gradient with grain, Float shadow, 1-unit border, scrolled to the
    // bottom, and a panned wide image.
    preset: 'etsy43',
    m: 0.4, // also exercises the grain pattern's 0.6 minimum scale (1.2 × 0.4 < 0.6)
    size: [1200, 900],
    doc: {
      preset: 'etsy43', W: 3000, H: 2250, count: 3,
      slots: [
        sample('juniper', '16:10', { cx: 1500, cy: 1283, w: 1560 }, { fy: 100 }),
        wide('1:1', { cx: 720, cy: 945, w: 820 }, 70),
        sample('northbeam', '4:5', { cx: 2280, cy: 945, w: 760 }),
      ],
      order: [1, 2, 0],
      frame: { radius: 16, borderW: 1, borderC: '#343B5C', bar: 'none', shadow: { preset: 'float', blur: 140, x: 0, y: 80, opacity: 0.55, color: '#000000' } },
      background: background({ type: 'gradient', grad: { a: '#1B2244', b: '#3B2452', angle: 155 }, grain: 12 }),
    },
  },
  {
    // Etsy square, 2-up. Solid, Hard shadow (no blur, no ambient layer), thick border.
    preset: 'etsy11',
    m: 0.5,
    size: [1000, 1000],
    doc: {
      preset: 'etsy11', W: 2000, H: 2000, count: 2,
      slots: [
        sample('fieldnote', '16:10', { cx: 760, cy: 760, w: 1320 }, { fy: 55 }),
        sample('northbeam', '1:1', { cx: 1300, cy: 1350, w: 900 }, { fy: 40 }),
        spare(),
      ],
      order: [0, 1, 2],
      frame: { radius: 6, borderW: 4, borderC: '#16161A', bar: 'none', shadow: { preset: 'hard', blur: 0, x: 14, y: 14, opacity: 1, color: '#16161A' } },
      background: background({ type: 'solid', solid: '#FFD54A', grain: 0 }),
    },
  },
  {
    // Portrait 4:5, 2-up. A sample blurred as the background photo with dim and grain, Soft shadow,
    // white border, a panned wide image and a Full crop.
    preset: 'p45',
    m: null,
    size: [1080, 1350],
    doc: {
      preset: 'p45', W: 1080, H: 1350, count: 2,
      slots: [
        wide('4:5', { cx: 390, cy: 520, w: 560 }, 25),
        sample('northbeam', 'full', { cx: 760, cy: 900, w: 380 }),
        spare(),
      ],
      order: [0, 1, 2],
      frame: { radius: 18, borderW: 3, borderC: '#FFFFFF', bar: 'none', shadow: { preset: 'soft', blur: 50, x: 0, y: 18, opacity: 0.18, color: '#1D1D1B' } },
      background: background({ type: 'image', solid: '#3B2A2F', imageId: 'sample:juniper', imageName: 'Layout 1, blurred', blur: 40, dim: 0.2, grain: 6 }),
    },
  },
  {
    // Custom 1200 × 900, one image. Mesh without grain on another seed, no shadow, big radius, border.
    preset: 'custom',
    m: null,
    size: [1200, 900],
    doc: {
      preset: 'custom', W: 1200, H: 900, count: 1,
      slots: [
        sample('fieldnote', '4:3', { cx: 600, cy: 450, w: 840 }, { fy: 70 }),
        spare(),
        spare(),
      ],
      order: [0, 1, 2],
      frame: { radius: 40, borderW: 6, borderC: '#F5C27A', bar: 'none', shadow: { preset: 'none', blur: 0, x: 0, y: 0, opacity: 0, color: '#000000' } },
      background: background({ type: 'mesh', mesh: ['#2A1838', '#F08A6C', '#7C4DA6', '#F5C27A'], meshSeed: 41, grain: 0 }),
    },
  },
  {
    // Pinterest pin in the Editorial look: light window bars with rounded top corners, dark warm mesh
    // with texture and grain, a scrolled crop. (After the plain pin: golden-overlays uses the first.)
    name: 'pin-editorial',
    preset: 'pin',
    m: null,
    size: [1000, 1500],
    doc: {
      preset: 'pin', W: 1000, H: 1500, count: 3,
      slots: [
        sample('juniper', '16:10', { cx: 500, cy: 400, w: 800 }),
        sample('northbeam', '4:5', { cx: 300, cy: 1020, w: 460 }),
        sample('fieldnote', '4:5', { cx: 700, cy: 1090, w: 460 }, { fy: 12 }),
      ],
      order: [0, 1, 2],
      frame: { radius: 10, borderW: 0, borderC: '#FFFFFF', bar: 'light', shadow: { preset: 'lifted', blur: 80, x: 0, y: 40, opacity: 0.45, color: '#120D09' } },
      background: background({ type: 'mesh', mesh: ['#3A342E', '#5C5046', '#2B2521', '#4B4038'], meshSeed: 5, grain: 14, texture: 20 }),
    },
  },
];

/** The source of WIDE_ID: Juniper and Fieldnote side by side, drawn by the app's own renderer. */
export function wideSourceDoc(): Composition {
  return {
    preset: 'custom', W: 2880, H: 2560, count: 2,
    slots: [
      sample('juniper', 'full', { cx: 720, cy: 1280, w: 1440 }),
      sample('fieldnote', 'full', { cx: 2160, cy: 1280, w: 1440 }),
      spare(),
    ],
    order: [0, 1, 2],
    frame: { radius: 0, borderW: 0, borderC: '#FFFFFF', bar: 'none', shadow: { preset: 'none', blur: 0, x: 0, y: 0, opacity: 0, color: '#000000' } },
    background: background({ type: 'solid', solid: '#FFFFFF', grain: 0 }),
  };
}

/** Swaps the WIDE_ID placeholder for the id the image store gave the wide image. */
export function withWideId(doc: Composition, id: string): Composition {
  const d: Composition = JSON.parse(JSON.stringify(doc));
  d.slots.forEach((s) => { if (s.imageId === WIDE_ID) s.imageId = id; });
  if (d.background.imageId === WIDE_ID) d.background.imageId = id;
  return d;
}

export const usesWide = (doc: Composition) => doc.slots.slice(0, doc.count).some((s) => s.imageId === WIDE_ID) || doc.background.imageId === WIDE_ID;
