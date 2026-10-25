/* Pin variations (lib/variations.ts): six different takes on the canvas from the same pages, and
   putting one on the canvas as one undo step. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { isArranged } from '@/lib/canvas-size';
import { clone, defaultUi, type Composition, type MediaItem } from '@/lib/model';
import type { SiteBackgrounds } from '@/lib/palette';
import { useEditor } from '@/lib/store';
import { pinVariations } from '@/lib/variations';

const item = (k: number, nh = 4000): MediaItem => ({ imageId: `img_${k}`, name: `${k}.png`, source: { kind: 'file' }, nw: 1440, nh });
const withMedia = (pages: MediaItem[]): Composition => ({ ...defaultComposition(), media: pages });
const site: SiteBackgrounds = { mesh: ['#F4EEE8', '#F2C7B0', '#E8D4F0', '#CFE3F2'], grad: { a: '#F4EEE8', b: '#F2C7B0', angle: 160 }, solid: '#F4EEE8' };
const shown = (d: Composition) => d.slots.slice(0, d.count).map((s) => s.imageId);

describe('pinVariations', () => {
  it('six different takes: layouts, the page in front and backgrounds all change', () => {
    const src = withMedia([0, 1, 2, 3, 4].map((k) => item(k)));
    const v = pinVariations(src, site, null);
    expect(v.map((x) => x.label)).toEqual([
      'Columns · your background',
      'Scroll · site mesh',
      'Editorial · site gradient',
      'Columns · site color',
      'Cascade · site mesh, moved',
      'Cascade · your background',
    ]);
    expect(v.map((x) => shown(x.doc))).toEqual([
      ['img_0', 'img_1'], ['img_1'], ['img_2', 'img_3', 'img_4'], ['img_2', 'img_3'], ['img_3', 'img_4'], ['img_4', 'img_0', 'img_1'],
    ]);
    expect(v[1].doc.background).toMatchObject({ type: 'mesh', mesh: site.mesh });
    expect(v[2].doc.background).toMatchObject({ type: 'gradient', grad: site.grad });
    expect(v[3].doc.background).toMatchObject({ type: 'solid', solid: site.solid });
    // Everything else is the canvas's: size, frame, the gallery; each take starts arranged.
    for (const x of v) {
      expect([x.doc.W, x.doc.H, x.doc.frame, x.doc.media]).toEqual([src.W, src.H, src.frame, src.media]);
      expect(isArranged(x.doc, null)).toBe(true);
    }
    expect(src).toEqual(withMedia([0, 1, 2, 3, 4].map((k) => item(k)))); // untouched
  });

  it('a long lead page runs across two columns as one page', () => {
    const v = pinVariations(withMedia([item(0, 12000), item(1), item(2)]), site, null);
    const one = v.find((x) => x.label.startsWith('One page'))!;
    expect(shown(one.doc)).toEqual(['img_0', 'img_0']);
  });

  it('one page gives fewer takes, never the same twice; without site colors the mesh moves', () => {
    const v = pinVariations(withMedia([item(0)]), null, null);
    expect(new Set(v.map((x) => JSON.stringify([x.label, x.doc.background]))).size).toBe(v.length);
    expect(v.every((x) => x.doc.count === 1)).toBe(true);
    expect(v.some((x) => x.label.endsWith('mesh, moved'))).toBe(true);
  });

  it('with nothing in Media it varies the layouts on the canvas', () => {
    expect(pinVariations(defaultComposition(), site, null).length).toBeGreaterThan(1);
  });
});

describe('store.putComposition', () => {
  it('puts a variation on the canvas as one undo step', () => {
    const S = () => useEditor.getState();
    const src = withMedia([0, 1, 2].map((k) => item(k)));
    S().loadComposition(src);
    useEditor.setState({ ui: { ...defaultUi(), selected: 1 }, toast: null });
    const v = pinVariations(src, site, null)[2];
    S().putComposition(v.doc);
    expect(S().doc).toEqual(v.doc);
    expect(S().ui.selected).toBeNull();
    S().undo();
    expect(S().doc).toEqual(clone(src));
  });
});
