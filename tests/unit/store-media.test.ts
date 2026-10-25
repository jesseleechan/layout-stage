/* The store with the media gallery: every image added joins it, past three wait there, a gallery image
   goes into the selected layout (or by the one-file rule), the gallery only keeps twelve, and
   re-captures take their old capture's place. The image store is mocked (no IndexedDB here). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const images = vi.hoisted(() => ({ n: 0, released: [] as [string, boolean][] }));
vi.mock('@/lib/images', () => ({
  ingestImage: async () => ({ id: `img_${++images.n}`, nw: 1440, nh: 4000 }),
  loadImage: async () => null,
  releaseImage: (id: string | null | undefined, keepThumb = false) => { if (id) images.released.push([id, keepThumb]); },
  pruneImages: async () => {},
}));

import { defaultComposition } from '@/lib/arrange';
import { isArranged } from '@/lib/canvas-size';
import { MAX_MEDIA, mediaOf } from '@/lib/media';
import { clone, DEFAULT_CAPTURE, defaultUi, type Composition, type MediaItem, type SlotSource } from '@/lib/model';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();
const doc = () => S().doc;
const media = () => mediaOf(doc()).map((m) => m.name);
const shown = () => doc().slots.slice(0, doc().count).map((s) => s.name);
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const files = (n: number, from = 1) => Array.from({ length: n }, (_, k) => file(`f${from + k}.png`));
const item = (k: string): MediaItem => ({ imageId: `img_${k}`, name: `${k}.png`, source: { kind: 'file' }, nw: 1440, nh: 4000 });

function load(d: Composition = defaultComposition()) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
}

/** Layouts 1 and 2 show a and b; c and d wait in the gallery. */
function gallery(): Composition {
  const d = defaultComposition();
  Object.assign(d.slots[0], item('a'));
  Object.assign(d.slots[1], item('b'));
  d.media = ['a', 'b', 'c', 'd'].map(item);
  return d;
}

beforeEach(() => {
  load();
  images.released.length = 0;
});

describe('images coming in join the gallery', () => {
  it('one upload is placed and kept', async () => {
    await S().placeFiles([file('one.png')], null);
    expect(shown()[0]).toBe('one.png');
    expect(media()).toEqual(['one.png']);
  });

  it('past three, the rest wait in Media; one undo step for all of it', async () => {
    await S().placeFiles(files(5), null);
    expect(shown()).toEqual(['f1.png', 'f2.png', 'f3.png']);
    expect(media()).toEqual(['f1.png', 'f2.png', 'f3.png', 'f4.png', 'f5.png']);
    expect(S().toast?.msg).toBe('Placed 3 layouts. 2 more are in Media.');
    S().undo();
    expect(doc()).toEqual(defaultComposition());
  });

  it(`takes at most ${MAX_MEDIA} files at once`, async () => {
    await S().placeFiles(files(MAX_MEDIA + 3), null);
    expect(media()).toHaveLength(MAX_MEDIA);
  });

  it('Add puts images in the gallery only, as one undo step', async () => {
    const before = clone(doc());
    await S().addMediaFiles(files(2));
    expect(doc().slots).toEqual(before.slots);
    expect(media()).toEqual(['f1.png', 'f2.png']);
    expect(S().toast?.msg).toBe('Added 2 images to Media.');
    S().undo();
    expect(doc()).toEqual(before);
  });

  it('a non-image is refused with a hint', async () => {
    await S().addMediaFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(S().toast?.msg).toBe('Use PNG, JPG or WebP images.');
    expect(media()).toEqual([]);
  });

  it('layouts coming back into view join it', () => {
    const d = defaultComposition();
    Object.assign(d.slots[2], item('hidden'));
    load(d);
    S().setCount(3);
    expect(media()).toEqual(['hidden.png']);
  });
});

describe('the gallery keeps twelve', () => {
  it('the oldest not on the canvas make room, with a note; undo brings them back', async () => {
    load(gallery());
    await S().addMediaFiles(files(MAX_MEDIA - 2));
    expect(media()).toHaveLength(MAX_MEDIA);
    expect(media().slice(0, 3)).toEqual(['a.png', 'b.png', 'f1.png']); // c and d made room
    expect(S().toast?.msg).toBe(`Added 10 images to Media. Media keeps ${MAX_MEDIA}: the 2 oldest unused images were removed.`);
    S().undo();
    expect(media()).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
  });
});

describe('placeMedia', () => {
  beforeEach(() => load(gallery()));

  it('puts the image in the selected layout and selects it, as one undo step', () => {
    S().select(1);
    S().placeMedia('img_c', 1);
    expect(shown()).toEqual(['a.png', 'c.png']);
    expect(S().ui.selected).toBe(1);
    expect(media()).toEqual(['a.png', 'b.png', 'c.png', 'd.png']); // b stays in Media
    S().undo();
    expect(shown()).toEqual(['a.png', 'b.png']);
  });

  it('with no layout picked: a sample’s place, else a new layout', () => {
    const d = gallery();
    d.slots[1] = clone(defaultComposition().slots[1]);
    load(d);
    S().placeMedia('img_c', null);
    expect(shown()).toEqual(['a.png', 'c.png']);
    S().placeMedia('img_d', null);
    expect(shown()).toEqual(['a.png', 'c.png', 'd.png']);
    expect(S().ui.selected).toBe(2);
    // Fresh showcase layouts are arranged again for the new pages.
    expect(isArranged(doc())).toBe(true);
  });

  it('the image already there, or one not in the gallery, changes nothing', () => {
    const before = clone(doc());
    S().placeMedia('img_a', 0);
    S().placeMedia('img_zzz', 0);
    expect(doc()).toEqual(before);
    expect(S().canUndo).toBe(false);
    expect(S().ui.selected).toBe(0);
  });

  it('the image leaving the canvas keeps its thumbnail for the gallery', () => {
    S().placeMedia('img_c', 1);
    expect(images.released).toContainEqual(['img_b', true]);
  });
});

describe('removeMediaItem', () => {
  beforeEach(() => load(gallery()));

  it('removes an image no layout shows, as one undo step', () => {
    S().removeMediaItem('img_c');
    expect(media()).toEqual(['a.png', 'b.png', 'd.png']);
    S().undo();
    expect(media()).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
  });

  it('leaves an image on the canvas alone', () => {
    S().removeMediaItem('img_a');
    expect(media()).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
    expect(S().canUndo).toBe(false);
  });
});

describe('captures', () => {
  const src = (url: string): SlotSource => ({ kind: 'url', url, capturedAt: '2026-10-01T00:00:00.000Z', options: DEFAULT_CAPTURE });
  const png = () => new Blob(['x'], { type: 'image/png' });

  it('a capture joins the gallery; a re-capture takes its place there', async () => {
    const id = await S().landCapture({ blob: png(), name: 'example.com', source: src('https://example.com') }, { targetId: null });
    await S().addMediaFiles([file('other.png')]);
    expect(media()).toEqual(['example.com', 'other.png']);
    const again = await S().landCapture({ blob: png(), name: 'example.com', source: src('https://example.com') }, { targetId: id, keepFraming: true });
    expect(mediaOf(doc()).map((m) => m.imageId)).toEqual([again, expect.stringMatching(/^img_/)]);
    expect(doc().slots.some((s) => s.imageId === id)).toBe(false);
  });
});
