/* Which images the store releases (object URLs revoked, decoded copy dropped) as the doc changes: an
   image is released as soon as no visible layout and no image background shows it. The image module
   is mocked, so this runs in node and records the calls. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { defaultUi, type Composition } from '@/lib/model';

const { released, ingest } = vi.hoisted(() => ({
  released: [] as string[],
  ingest: { n: 0 },
}));
vi.mock('@/lib/images', () => ({
  releaseImage: (id: string | null | undefined) => {
    if (id) released.push(id);
  },
  ingestImage: async () => ({ id: `img_new${++ingest.n}`, nw: 2000, nh: 1250 }),
  pruneImages: async () => {},
  loadImage: async () => null,
}));

import { shownIds, useEditor } from '@/lib/store';

const S = () => useEditor.getState();
/** Distinct released ids, sorted (the store may release an id twice; releasing is idempotent). */
const rel = () => [...new Set(released)].sort();
const png = () => new Blob([new Uint8Array(8)], { type: 'image/png' });

/** Three uploaded layouts (img_a, img_b, img_c) on a photo background (img_bg). */
function doc3(): Composition {
  const d = defaultComposition();
  d.count = 3;
  (['img_a', 'img_b', 'img_c'] as const).forEach((id, i) => Object.assign(d.slots[i], { imageId: id, source: { kind: 'file' } }));
  Object.assign(d.background, { type: 'image', imageId: 'img_bg', imageName: 'photo.jpg' });
  return d;
}

beforeEach(() => {
  S().loadComposition(doc3());
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
  released.length = 0;
});

describe('shownIds', () => {
  it('is the visible layouts plus the background photo while the background is an image', () => {
    const d = doc3();
    expect([...shownIds(d)].sort()).toEqual(['img_a', 'img_b', 'img_bg', 'img_c']);
    d.count = 2;
    d.background.type = 'mesh';
    expect([...shownIds(d)].sort()).toEqual(['img_a', 'img_b']);
    d.background = { ...d.background, type: 'image', imageId: null };
    expect([...shownIds(d)].sort()).toEqual(['img_a', 'img_b']);
  });
});

describe('releasing images that are no longer shown', () => {
  it('replace: the old image goes, once', async () => {
    await S().addImage({ blob: png(), name: 'x.png', source: { kind: 'file' } }, 1);
    expect(S().doc.slots[1].imageId).toMatch(/^img_new/);
    expect(rel()).toEqual(['img_b']);
  });

  it('undo and redo release what they take off the canvas', async () => {
    await S().addImage({ blob: png(), name: 'x.png', source: { kind: 'file' } }, 0);
    const added = S().doc.slots[0].imageId;
    released.length = 0;
    S().undo();
    expect(S().doc.slots[0].imageId).toBe('img_a');
    expect(rel()).toEqual([added]);
    released.length = 0;
    S().redo();
    expect(rel()).toEqual(['img_a']);
  });

  it('remove and fewer layouts release the hidden image; showing it again releases nothing', () => {
    S().removeSlot(0);
    expect(rel()).toEqual(['img_a']);
    released.length = 0;
    S().undo();
    expect(rel()).toEqual([]);
    S().setCount(1);
    expect(rel()).toEqual(['img_b', 'img_c']);
    released.length = 0;
    S().setCount(3);
    expect(rel()).toEqual([]);
  });

  it('a hidden layout dropped from the doc is released (an added image takes its slot)', async () => {
    S().setCount(2);
    released.length = 0;
    await S().addImage({ blob: png(), name: 'x.png', source: { kind: 'file' } }, null);
    expect(S().doc.count).toBe(3);
    expect(S().doc.slots[2].imageId).toMatch(/^img_new/);
    expect(rel()).toEqual(['img_c']);
  });

  it('a background type switch releases the photo; switching back releases nothing', () => {
    S().setBackgroundType('solid');
    expect(rel()).toEqual(['img_bg']);
    released.length = 0;
    S().setBackgroundType('image');
    S().pickGradient(0);
    S().applyStyle({ name: 't', frame: S().doc.frame, background: { type: 'image' } });
    expect(rel()).toEqual(['img_bg']);
  });

  it('a photo shared by a layout and the background stays while either shows it', () => {
    S().select(1);
    S().backgroundFromLayout();
    expect(S().doc.background.imageId).toBe('img_b');
    expect(rel()).toEqual(['img_bg']);
    released.length = 0;
    S().setBackgroundType('mesh');
    expect(rel()).toEqual([]);
  });

  it('live edits and commits that keep the same images release nothing', () => {
    S().edit((d) => { d.slots[0].cx += 40; });
    S().commit();
    S().editBackground({ blur: 30 });
    S().commit();
    S().setCrop(2, '1:1');
    S().rearrange();
    expect(rel()).toEqual([]);
  });

  it('loading another canvas releases what the old one showed', () => {
    S().loadComposition(defaultComposition());
    expect(rel()).toEqual(['img_a', 'img_b', 'img_bg', 'img_c']);
  });
});
