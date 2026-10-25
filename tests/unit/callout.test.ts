/* Zoom and zoom callouts (lib/callout.ts, Slot.zoom): the cover crop zoomed in, what scrolls, a
   callout's page, magnification, window and place, and zoom surviving a save but not a new image. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { addCallout, CALLOUT_MAGNIFY } from '@/lib/callout';
import { putImage } from '@/lib/media';
import { defaultUi, type Composition, type Slot } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { coverSource, rectOf, scrollAxis, zoomOf } from '@/lib/render/units';
import { useEditor } from '@/lib/store';

const page = (patch: Partial<Slot> = {}): Slot => ({
  imageId: 'img_page', name: 'page.png', source: { kind: 'file' }, nw: 1440, nh: 3600, crop: '4:3', fx: 50, fy: 30, cx: 400, cy: 600, w: 400, ...patch,
});

describe('zoom', () => {
  it('coverSource shows 1/zoom of the window, placed by fx and fy on both axes', () => {
    const one = coverSource(1440, 3600, 400, 300, 50, 30);
    const two = coverSource(1440, 3600, 400, 300, 50, 30, 2);
    expect([two.sw, two.sh]).toEqual([one.sw / 2, one.sh / 2]);
    expect(two.sx).toBeCloseTo((1440 - 720) / 2, 9);
    expect(two.sy).toBeCloseTo((3600 - one.sh / 2) * 0.3, 9);
    expect(coverSource(1440, 3600, 400, 300, 50, 30, 0.5)).toEqual(one); // never below 1
  });

  it('a zoomed layout scrolls even with the frame the image’s own shape', () => {
    expect(scrollAxis(page({ crop: 'full' }))).toBeNull();
    expect(scrollAxis(page({ crop: 'full', zoom: 2 }))).toBe('y');
    expect([zoomOf(page()), zoomOf(page({ zoom: 0.5 })), zoomOf(page({ zoom: 9 }))]).toEqual([1, 1, 4]);
  });

  it('a save keeps 1–4 and drops the rest; a new image starts unzoomed', () => {
    const d = defaultComposition();
    Object.assign(d.slots[0], { zoom: 2.5 });
    Object.assign(d.slots[1], { zoom: 'x' });
    Object.assign(d.slots[2], { zoom: 12 });
    const out = sanitizeComposition(d)!;
    expect([out.slots[0].zoom, 'zoom' in out.slots[1], out.slots[2].zoom]).toEqual([2.5, false, 4]);
    putImage(out, 0, { imageId: 'img_new', name: 'n.png', source: { kind: 'file' }, nw: 1440, nh: 4000 });
    expect('zoom' in out.slots[0]).toBe(false);
  });
});

describe('addCallout', () => {
  /** Layout 1 is a page cropped 4:3 and scrolled; layout 2 a sample; layout 3 hidden. */
  function doc(): Composition {
    const d = defaultComposition();
    Object.assign(d.slots[0], page({ cx: 330, cy: 700, w: 520 }));
    return d;
  }

  it('the same page, on top, magnified, centered on what the layout shows', () => {
    const d = doc();
    addCallout(d, 0, 2);
    const [src, , c] = d.slots;
    expect([d.count, d.order.at(-1), c.imageId, c.crop]).toEqual([3, 2, src.imageId, '4:3']);
    // Page px per canvas px: the callout's is CALLOUT_MAGNIFY times smaller.
    const rs = rectOf(src), rc = rectOf(c);
    const ws = coverSource(src.nw, src.nh, rs.w, rs.h, src.fx, src.fy, zoomOf(src));
    const wc = coverSource(c.nw, c.nh, rc.w, rc.h, c.fx, c.fy, zoomOf(c));
    expect((ws.sw / rs.w) / (wc.sw / rc.w)).toBeCloseTo(CALLOUT_MAGNIFY, 1);
    // Its window's middle is the middle of what layout 1 shows (all of it is on the canvas here).
    expect(wc.sx + wc.sw / 2).toBeCloseTo(ws.sx + ws.sw / 2, 0);
    expect(wc.sy + wc.sh / 2).toBeCloseTo(ws.sy + ws.sh / 2, 0);
    // Inside the canvas, overlapping layout 1.
    expect(rc.l).toBeGreaterThanOrEqual(0);
    expect(rc.l + rc.w).toBeLessThanOrEqual(d.W);
    expect(rc.l).toBeLessThan(rs.l + rs.w);
  });

  it('store: one undo step and the callout selected; no fourth layout', () => {
    const S = () => useEditor.getState();
    S().loadComposition(doc());
    useEditor.setState({ ui: { ...defaultUi(), selected: 0 }, toast: null });
    S().addCallout(0);
    expect([S().doc.count, S().ui.selected, S().doc.slots[2].zoom! > 1]).toEqual([3, 2, true]);
    S().setZoom(2, 3);
    S().setWindow(2, { fx: 120, fy: -5 });
    expect([S().doc.slots[2].zoom, S().doc.slots[2].fx, S().doc.slots[2].fy]).toEqual([3, 100, 0]);
    S().commit();
    S().addCallout(0);
    expect(S().toast?.msg).toMatch(/3 already/);
    S().undo();
    S().undo();
    expect(S().doc.count).toBe(2);
  });
});
