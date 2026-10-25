/* store.landCapture: where a captured image lands, keeping a re-captured layout's framing, as one
   undo step that leaves an edit in progress out. The image store (IndexedDB, <img>) is mocked. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrange } from '@/lib/arrange';
import { clone, DEFAULT_CAPTURE, defaultUi, type Composition, type SlotSource } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { classicComposition } from './helpers';

const images = vi.hoisted(() => ({ seq: 0, next: [1440, 4000] as [number, number], sizes: new Map<string, [number, number]>() }));
vi.mock('@/lib/images', () => ({
  putImage: vi.fn(async () => {
    const id = `img:${++images.seq}`;
    images.sizes.set(id, images.next);
    return id;
  }),
  loadImage: vi.fn(async (id: string) => {
    const s = images.sizes.get(id);
    return s ? ({ naturalWidth: s[0], naturalHeight: s[1] } as HTMLImageElement) : null;
  }),
  // The store ingests through ingestImage (store + decode, downscaled when over budget).
  ingestImage: vi.fn(async () => {
    const id = `img:${++images.seq}`;
    images.sizes.set(id, images.next);
    return { id, nw: images.next[0], nh: images.next[1] };
  }),
  pruneImages: vi.fn(async () => undefined),
  releaseImage: vi.fn(),
}));

const S = () => useEditor.getState();
const doc = () => S().doc;
const png = () => new Blob(['x'], { type: 'image/png' });
const src = (url: string): SlotSource => ({ kind: 'url', url, capturedAt: '2026-10-01T00:00:00.000Z', options: DEFAULT_CAPTURE });

/** Two layouts; layout 2 is a framed capture of a 1440 × 4000 page. */
function framed(): Composition {
  const d = classicComposition();
  d.count = 2;
  arrange(d);
  images.sizes.set('img:page', [1440, 4000]);
  Object.assign(d.slots[1], { imageId: 'img:page', name: 'example.com', source: src('https://example.com'), nw: 1440, nh: 4000, crop: '4:3', fx: 50, fy: 40, cx: 610, cy: 900, w: 640 });
  return d;
}

beforeEach(() => {
  S().loadComposition(framed());
  useEditor.setState({ ui: { ...defaultUi(), selected: 0 }, toast: null });
  images.next = [1440, 4000];
});

describe('landCapture', () => {
  it('re-capture: replaces the image, keeps the framing, one undo step, selection untouched', async () => {
    const before = clone(doc().slots[1]);
    const id = await S().landCapture({ blob: png(), name: 'example.com', source: src('https://example.com') }, { targetId: 'img:page', keepFraming: true });
    const after = doc().slots[1];
    expect(after.imageId).toBe(id);
    expect(after).toMatchObject({ crop: '4:3', fx: 50, fy: 40, cx: 610, cy: 900, w: 640, nw: 1440, nh: 4000 });
    expect(S().ui.selected).toBe(0);
    S().undo();
    expect(doc().slots[1]).toEqual(before);
    expect(S().canUndo).toBe(false);
  });

  it('re-capture of a page that got longer keeps the same part in view', async () => {
    images.next = [1440, 8000];
    await S().landCapture({ blob: png(), name: 'example.com', source: src('https://example.com') }, { targetId: 'img:page', keepFraming: true });
    const s = doc().slots[1];
    // 4:3 at 640 px wide shows 1080 page px; at 40 % of 4000 − 1080 the window starts at 1168 px.
    expect(s.nh).toBe(8000);
    expect(s.fy).toBeCloseTo((1168 / (8000 - 1080)) * 100, 1);
  });

  it('leaves a drag in progress out of its undo step', async () => {
    S().edit((d) => { d.slots[1].cx = 777; }); // dragging, not committed
    await S().landCapture({ blob: png(), name: 'example.com', source: src('https://example.com') }, { targetId: 'img:page', keepFraming: true });
    expect(doc().slots[1].cx).toBe(777); // the drag is still under the pointer
    S().commit(); // drag ends
    S().undo();
    expect(doc().slots[1]).toMatchObject({ cx: 610, imageId: expect.stringMatching(/^img:\d+$/) }); // new image, old position
    S().undo();
    expect(doc().slots[1]).toMatchObject({ cx: 610, imageId: 'img:page' });
  });

  it('a new capture fills its target fresh and selects it', async () => {
    images.next = [2880, 9000];
    await S().landCapture({ blob: png(), name: 'b.com', source: src('https://b.com') }, { targetId: 'img:page' });
    expect(doc().slots[1]).toMatchObject({ name: 'b.com', crop: '16:10', fx: 50, fy: 0, nw: 2880, nh: 9000 });
    expect(S().ui.selected).toBe(1);
  });

  it('when the target is gone: the drop-elsewhere rule, never on top of the other half of a pair', async () => {
    const first = doc().slots[0].imageId; // a sample
    await S().landCapture({ blob: png(), name: 'phone', source: src('https://a.com') }, { targetId: 'img:removed', avoidId: first });
    expect(doc().count).toBe(3); // layout 1 was avoided, layout 2 isn't a sample: a layout is added
    expect(doc().slots[2].name).toBe('phone');
    expect(doc().slots[0].imageId).toBe(first);
  });

  it('refuses something that isn’t an image', async () => {
    const id = await S().landCapture({ blob: new Blob(['x'], { type: 'text/html' }), name: 'x', source: src('https://a.com') }, { targetId: 'img:page', keepFraming: true });
    expect(id).toBeNull();
    expect(doc().slots[1].imageId).toBe('img:page');
    expect(S().toast?.msg).toMatch(/isn’t an image/);
  });
});

describe('openRecapture', () => {
  it('opens the dialog on that layout in re-capture mode; openCapture does not', () => {
    S().openRecapture(1);
    expect(S().captureDialog).toEqual({ open: true, target: 1, recapture: true });
    S().closeCapture();
    S().openCapture(1);
    expect(S().captureDialog.recapture).toBeFalsy();
  });
});
