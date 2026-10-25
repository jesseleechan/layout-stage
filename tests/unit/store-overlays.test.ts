/* Store actions for the headline, badge and watermark: live edits save no step, discrete changes save
   one, and a logo lands as one step once it has loaded. The image store is mocked (no IndexedDB here). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const images = vi.hoisted(() => ({ next: 0, released: [] as string[] }));
vi.mock('@/lib/images', () => ({
  putImage: async () => `img_logo${++images.next}`,
  loadImage: async (id: string | null) => (id ? { naturalWidth: 480, naturalHeight: 160 } : null),
  releaseImage: (id: string) => { images.released.push(id); },
  pruneImages: async () => {},
  useImageUrl: () => null,
  useLoadedImage: () => null,
}));

import { defaultComposition } from '@/lib/arrange';
import { defaultUi, type Composition } from '@/lib/model';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();
const o = () => S().doc.overlays!;

function load(d: Composition = defaultComposition()) {
  S().loadComposition(d);
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
}
const file = (name = 'logo.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });

beforeEach(() => {
  load();
  images.released = [];
});

describe('overlay actions', () => {
  it('a switch is one undo step', () => {
    S().setOverlay('headline', { enabled: true });
    expect(o().headline.enabled).toBe(true);
    expect(S().canUndo).toBe(true);
    S().undo();
    expect(o().headline.enabled).toBe(false);
    expect(S().canUndo).toBe(false);
  });

  it('live edits (typing, sliders) save no step until commit, then exactly one', () => {
    S().setOverlay('headline', { enabled: true });
    for (const t of ['N', 'Ne', 'New', 'New t', 'New theme']) S().editOverlay('headline', { text: t });
    S().editOverlay('headline', { size: 120 });
    S().undo(); // the live edits were never saved: undo goes back past the switch
    expect(o().headline).toMatchObject({ enabled: false, size: 84 });
    S().redo();
    for (const t of ['N', 'Ne', 'New']) S().editOverlay('headline', { text: t });
    S().commit();
    expect(o().headline.text).toBe('New');
    S().undo();
    expect(o().headline).toMatchObject({ enabled: true, text: defaultComposition().overlays!.headline.text });
  });

  it('works on compositions from before overlays existed', () => {
    const d = defaultComposition();
    delete d.overlays;
    load(d);
    S().setOverlay('badge', { enabled: true, text: '$29' });
    expect(o().badge).toMatchObject({ enabled: true, text: '$29' });
    expect(o().headline.enabled).toBe(false);
  });

  it('switching on a logo watermark without a logo asks for one', () => {
    S().setOverlay('watermark', { enabled: true });
    expect(S().toast?.msg).toBe('Upload a logo, or switch to text.');
  });

  it('an uploaded logo is one step, switches the watermark on, and releases the logo it replaces', async () => {
    await S().setWatermarkLogo(file());
    expect(o().watermark).toMatchObject({ enabled: true, kind: 'logo', imageId: 'img_logo1', imageName: 'logo.png', nw: 480, nh: 160 });
    await S().setWatermarkLogo(file('mark.png'));
    expect(o().watermark.imageId).toBe('img_logo2');
    expect(images.released).toEqual(['img_logo1']);
    S().undo();
    expect(o().watermark.imageId).toBe('img_logo1');
    S().undo();
    expect(o().watermark).toMatchObject({ enabled: false, imageId: null });
  });

  it('rejects files that are not images', async () => {
    await S().setWatermarkLogo(file('notes.txt', 'text/plain'));
    expect(S().toast?.msg).toMatch(/PNG, JPG or WebP/);
    expect(S().canUndo).toBe(false);
  });
});
