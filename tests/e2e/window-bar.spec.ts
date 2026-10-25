/* Window bar (lib/render/bar.ts): the preview's CSS bar and the export's canvas bar come from the same
   geometry, so a screenshot of the preview at scale 1 matches the export there, up to antialiasing.
   Shadow, grain and texture are off so only the frame is compared. */
import type { Page } from '@playwright/test';
import type { Composition, FrameBar } from '../../lib/model';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** 600 × 400, one 480 × 300 layout at (60, 50): small enough to show whole at scale 1. */
function barDoc(bar: FrameBar): Composition {
  const s = (id: string): Composition['slots'][number] => ({
    imageId: `sample:${id}`, name: id, source: { kind: 'sample' }, nw: 1440, nh: 2560, crop: '16:10', fx: 50, fy: 0, cx: 300, cy: 200, w: 480,
  });
  return {
    preset: 'custom', W: 600, H: 400, count: 1,
    slots: [s('northbeam'), s('juniper'), s('fieldnote')],
    order: [0, 1, 2],
    frame: { radius: 12, borderW: 2, borderC: '#C23B22', bar, shadow: { preset: 'none', blur: 0, x: 0, y: 0, opacity: 0, color: '#000000' } },
    background: {
      type: 'solid', solid: '#5C5046', grad: { a: '#FFE6C7', b: '#FF9A8B', angle: 160 }, mesh: ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'],
      meshSeed: 3, imageId: null, imageName: '', blur: 0, dim: 0, grain: 0, texture: 0,
    },
  };
}

for (const bar of ['light', 'dark'] as const) {
  test(`the preview draws the ${bar} window bar where the export does`, async ({ page }) => {
    await openEditor(page);
    await page.evaluate((doc) => window.__layoutStage!.store.getState().loadComposition(doc), barDoc(bar));
    // The canvas size changed, so the board fits it to the viewport first; then show it at 1:1.
    await page.waitForFunction(() => document.getElementById('stageWrap')?.style.width !== '');
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__layoutStage!.store.getState().setScale(1));
    await page.waitForTimeout(500); // the image decodes, the background repaints
    const box = (await page.locator('#stageWrap').boundingBox())!;
    expect([box.width, box.height]).toEqual([600, 400]);
    const shot = await page.screenshot({ clip: { x: Math.round(box.x), y: Math.round(box.y), width: 600, height: 400 } });

    const r = await page.evaluate(async (b64) => {
      const LS = window.__layoutStage!;
      const exp = await LS.renderComposition(LS.store.getState().doc, 1);
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 400;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const a = c.getContext('2d')!.getImageData(0, 0, 600, 400).data;
      const e = exp.getContext('2d')!.getImageData(0, 0, 600, 400).data;
      // The layout's top 60 px: the bar (17.3 px), the border and the top of the page. Each export
      // pixel must lie, per channel, within the range of the preview's 3 × 3 pixels around it (± 13
      // levels, 5%). The preview may sit a fraction of a pixel off and snaps edges the export
      // antialiases (a blend of two neighbors is in their range), but a moved or missing piece fails.
      const near = (x: number, y: number) => {
        const i = (y * 600 + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const v = a[((y + dy) * 600 + x + dx) * 4 + ch];
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
          }
          if (e[i + ch] < lo - 13 || e[i + ch] > hi + 13) return false;
        }
        return true;
      };
      let off = 0, n = 0;
      for (let y = 46; y < 110; y++) for (let x = 56; x < 544; x++, n++) if (!near(x, y)) off++;
      // The bar is there: its fill color shows in both, between the dots and the address field.
      const px = (d: Uint8ClampedArray, x: number, y: number) => Array.from(d.slice((y * 600 + x) * 4, (y * 600 + x) * 4 + 3));
      const fill = px(e, 140, 58);
      // Where the dots and the field are, to a fraction of a pixel: the centroid and amount of
      // "not bar fill" inside the bar, over the dots (x 66–110, clear of the border and the corner)
      // and over the field (x 150–450).
      const ink = (d: Uint8ClampedArray, x0: number, x1: number) => {
        let w = 0, sx = 0, sy = 0;
        for (let y = 52; y < 66; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * 600 + x) * 4;
            const v = Math.abs(d[i] - fill[0]) + Math.abs(d[i + 1] - fill[1]) + Math.abs(d[i + 2] - fill[2]);
            w += v; sx += v * x; sy += v * y;
          }
        }
        return { w, x: sx / w, y: sy / w };
      };
      return {
        off, n, preview: px(a, 140, 58), exported: fill,
        dots: [ink(a, 66, 110), ink(e, 66, 110)], field: [ink(a, 150, 450), ink(e, 150, 450)],
      };
    }, shot.toString('base64'));

    expect(r.off / r.n).toBeLessThan(0.002);
    expect(r.exported).toEqual(bar === 'light' ? [0xf3, 0xf2, 0xef] : [0x2b, 0x2a, 0x2d]);
    expect(r.preview).toEqual(r.exported);
    for (const [preview, exported] of [r.dots, r.field]) {
      // within ½ px (the preview may sit a fraction of a pixel off), and the same size within 5%
      expect(Math.abs(preview.x - exported.x)).toBeLessThan(0.5);
      expect(Math.abs(preview.y - exported.y)).toBeLessThan(0.5);
      expect(preview.w / exported.w).toBeGreaterThan(0.95);
      expect(preview.w / exported.w).toBeLessThan(1.05);
    }
  });
}
