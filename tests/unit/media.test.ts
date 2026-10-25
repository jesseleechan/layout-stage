/* The media gallery's rules (lib/media.ts): what joins it, what makes room, what can leave, where a
   picked image goes and how it fits the layout; plus reading it back from a save and carrying it with
   a project. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { addMedia, keepShownInMedia, MAX_MEDIA, mediaOf, putImage, removeMedia, replaceMedia, sanitizeMedia, slotFor } from '@/lib/media';
import { DEFAULT_CAPTURE, type Composition, type MediaItem } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { projectImageIds, referencedImageIds } from '@/lib/projects/model';
import { rectOf } from '@/lib/render/units';
import { classicComposition } from './helpers';

const item = (k: number | string, nw = 1440, nh = 4000): MediaItem => ({ imageId: `img_${k}`, name: `${k}.png`, source: { kind: 'file' }, nw, nh });
const ids = (d: Composition) => mediaOf(d).map((m) => m.imageId);

/** Layouts 1 and 2 show img_a and img_b (both in the gallery); layout 3 is hidden. */
function shown(): Composition {
  const d = defaultComposition();
  for (const [i, k] of [[0, 'a'], [1, 'b']] as const) Object.assign(d.slots[i], item(k));
  d.media = [item('a'), item('b')];
  return d;
}

describe('addMedia', () => {
  it('adds to the end, once each, never a sample, and leaves no empty list behind', () => {
    const d = defaultComposition();
    expect(addMedia(d, [d.slots[0]])).toBe(0); // a sample
    expect('media' in d).toBe(false);
    addMedia(d, [item(1), item(2), item(1)]);
    addMedia(d, [item(2), item(3)]);
    expect(ids(d)).toEqual(['img_1', 'img_2', 'img_3']);
  });

  it(`keeps ${MAX_MEDIA}: the oldest not in a visible layout make room`, () => {
    const d = shown();
    const dropped = addMedia(d, Array.from({ length: MAX_MEDIA }, (_, k) => item(k)));
    expect(dropped).toBe(2);
    // img_a and img_b are on the canvas, so the two oldest others went.
    expect(ids(d)).toEqual(['img_a', 'img_b', ...Array.from({ length: MAX_MEDIA - 2 }, (_, k) => `img_${k + 2}`)]);
  });

  it('copies what it keeps', () => {
    const d = defaultComposition();
    const it = item(1);
    addMedia(d, [it]);
    it.name = 'changed';
    expect(mediaOf(d)[0].name).toBe('1.png');
  });
});

describe('keepShownInMedia', () => {
  it('adds the visible layouts’ images that aren’t in the gallery, not hidden ones or samples', () => {
    const d = defaultComposition();
    Object.assign(d.slots[1], item('b'));
    Object.assign(d.slots[2], item('hidden'));
    keepShownInMedia(d);
    expect(ids(d)).toEqual(['img_b']);
    d.count = 3;
    keepShownInMedia(d);
    expect(ids(d)).toEqual(['img_b', 'img_hidden']);
  });
});

describe('removeMedia', () => {
  it('removes an image no visible layout shows; refuses one on the canvas', () => {
    const d = shown();
    addMedia(d, [item('c')]);
    expect(removeMedia(d, 'img_a')).toBe(false);
    expect(removeMedia(d, 'img_nope')).toBe(false);
    expect(removeMedia(d, 'img_c')).toBe(true);
    expect(ids(d)).toEqual(['img_a', 'img_b']);
  });

  it('drops the list when the last one goes', () => {
    const d = defaultComposition();
    addMedia(d, [item(1)]);
    removeMedia(d, 'img_1');
    expect('media' in d).toBe(false);
  });
});

describe('replaceMedia', () => {
  it('a re-capture takes the old capture’s place', () => {
    const d = shown();
    addMedia(d, [item('c')]);
    Object.assign(d.slots[1], item('b2')); // layout 2 now shows the new capture
    replaceMedia(d, 'img_b', item('b2'));
    expect(ids(d)).toEqual(['img_a', 'img_b2', 'img_c']);
  });

  it('keeps the old one while a visible layout still shows it', () => {
    const d = shown();
    Object.assign(d.slots[1], item('a')); // both layouts show img_a
    replaceMedia(d, 'img_a', item('a2'));
    expect(ids(d)).toEqual(['img_a', 'img_b', 'img_a2']);
  });
});

describe('slotFor', () => {
  it('the target, else the first sample, else a new layout, else layout 1', () => {
    const d = defaultComposition();
    expect(slotFor(d, 1)).toEqual({ i: 1, added: false });
    expect(slotFor(d, 2)).toEqual({ i: 0, added: false }); // hidden: the rule
    expect(slotFor(d, null)).toEqual({ i: 0, added: false });
    Object.assign(d.slots[0], item('a'));
    expect(slotFor(d, null)).toEqual({ i: 1, added: false });
    Object.assign(d.slots[1], item('b'));
    expect(slotFor(d, null)).toEqual({ i: 2, added: true });
    d.count = 3;
    Object.assign(d.slots[2], item('c'));
    expect(slotFor(d, null)).toEqual({ i: 0, added: false });
  });
});

describe('putImage', () => {
  it('showcase: the page whole, the layout’s width and top edge kept', () => {
    const d = defaultComposition();
    const { l, t, w } = rectOf(d.slots[1]);
    putImage(d, 1, item('long', 1440, 9000));
    const s = d.slots[1];
    expect([s.imageId, s.crop, s.fx, s.fy]).toEqual(['img_long', 'full', 50, 0]);
    expect(rectOf(s)).toMatchObject({ l, w });
    expect(rectOf(s).t).toBeCloseTo(t, 6);
  });

  it('classic: the crop a new image gets, no taller than the canvas allows', () => {
    const d = classicComposition();
    putImage(d, 0, item('tall', 600, 6000));
    expect(d.slots[0].crop).toBe('9:16');
    expect(rectOf(d.slots[0]).h).toBeLessThanOrEqual(d.H * 0.9);
  });
});

describe('saved galleries', () => {
  it('reads back well-formed images only, each once, the newest twelve', () => {
    const url: MediaItem = { imageId: 'img_u', name: 'example.com', source: { kind: 'url', url: 'https://example.com', capturedAt: 'x', options: DEFAULT_CAPTURE }, nw: 1440, nh: 3000 };
    const raw = [
      item('a'), null, { imageId: 'sample:juniper', nw: 1, nh: 1, source: { kind: 'sample' } }, { ...item('b'), nw: 0 },
      { ...item('c'), source: { kind: 'paste' } }, item('a'), url, ...Array.from({ length: 12 }, (_, k) => item(k)),
    ];
    const out = sanitizeMedia(raw);
    expect(out).toHaveLength(MAX_MEDIA);
    expect(out[0].imageId).toBe('img_0');
    expect(sanitizeMedia(raw.slice(0, 7)).map((m) => m.imageId)).toEqual(['img_a', 'img_u']);
    expect(sanitizeMedia('nope')).toEqual([]);
  });

  it('a canvas saved before the gallery gets its layouts’ images in it', () => {
    const d = defaultComposition();
    Object.assign(d.slots[0], item('a'));
    Object.assign(d.slots[2], item('hidden'));
    expect(ids(sanitizeComposition(d)!)).toEqual(['img_a']);
    expect('media' in sanitizeComposition(defaultComposition())!).toBe(false);
  });

  it('a project carries and keeps its gallery’s images', () => {
    const d = shown();
    addMedia(d, [item('9c1b-aaaa')]);
    expect(referencedImageIds(d)).toContain('img_9c1b-aaaa');
    expect(projectImageIds(d)).toContain('img_9c1b-aaaa');
  });
});
