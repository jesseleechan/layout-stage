/* Golden export test (milestone 5): a fixed composition exports to a PNG that matches a stored
   reference within a small pixel tolerance, for each canvas preset.

   Goldens live in tests/e2e/__golden__/ and are machine and font dependent (the sample sites draw
   text with system fonts; canvas antialiasing differs between platforms and GPUs). After an
   intended rendering change, or on a new machine, regenerate them and look at every PNG:
     PORT=3104 npx playwright test golden --update-snapshots
   Tolerance (maxDiffPixelRatio, threshold) is set in playwright.config.ts. */
import { expect, test, type Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { GOLDEN_CASES, usesWide, wideSourceDoc, withWideId } from './fixtures';

/** Opens the editor with web requests to other hosts blocked (the samples use system fonts only),
 *  and waits until the store has restored its (empty) autosave. */
async function openEditor(page: Page) {
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (r) => r.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** Builds the wide test image (two samples side by side) in the page and adds it to the image store
 *  through the normal add-image path. Returns its image id. */
async function addWideImage(page: Page): Promise<string> {
  return page.evaluate(async (src: Composition) => {
    const LS = window.__layoutStage!;
    const c = await LS.renderComposition(src, 1);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    if (!(await LS.store.getState().addImage({ blob, name: 'wide.png', source: { kind: 'file' } }, 0))) throw new Error('addImage failed');
    const s = LS.store.getState().doc.slots[0];
    if (s.nw !== src.W || s.nh !== src.H) throw new Error(`wide image is ${s.nw}×${s.nh}`);
    return s.imageId;
  }, wideSourceDoc());
}

interface Rendered {
  b64: string;
  w: number;
  h: number;
  type: string;
  name: string | null;
}

/** Loads the doc into the store, then exports (m null) or renders at m. Returns the PNG. */
async function render(page: Page, doc: Composition, m: number | null): Promise<Rendered> {
  return page.evaluate(
    async ({ doc, m }) => {
      const LS = window.__layoutStage!;
      LS.store.getState().loadComposition(doc);
      const d = LS.store.getState().doc;
      let blob: Blob, w: number, h: number, name: string | null = null;
      if (m == null) {
        const r = await LS.exportComposition(d, 'png', 1);
        ({ blob, w, h, name } = r);
      } else {
        const c = await LS.renderComposition(d, m);
        blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
        w = c.width;
        h = c.height;
      }
      const url = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      });
      return { b64: url.slice(url.indexOf(',') + 1), w, h, type: blob.type, name };
    },
    { doc, m },
  );
}

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test.describe('golden exports', () => {
  for (const c of GOLDEN_CASES) {
    test(`${c.preset} matches its golden`, async ({ page }) => {
      await openEditor(page);
      const doc = usesWide(c.doc) ? withWideId(c.doc, await addWideImage(page)) : c.doc;
      const r = await render(page, doc, c.m);
      const png = Buffer.from(r.b64, 'base64');
      expect(r.type).toBe('image/png');
      expect([r.w, r.h]).toEqual(c.size);
      expect(pngSize(png)).toEqual(c.size);
      expect(png).toMatchSnapshot(`${c.preset}.png`);
    });
  }
});

test.describe('export file', () => {
  test('default pin at 2× is 2000 × 3000 with the right name, as PNG and JPG', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      const LS = window.__layoutStage!;
      const st = LS.store.getState();
      const head = async (b: Blob) => Array.from(new Uint8Array(await b.slice(0, 24).arrayBuffer()));
      const png = await LS.exportComposition(st.doc, 'png', st.ui.exportScale);
      const jpg = await LS.exportComposition(st.doc, 'jpg', 2);
      return {
        preset: st.doc.preset, count: st.doc.count, exportScale: st.ui.exportScale,
        png: { w: png.w, h: png.h, name: png.name, format: png.format, type: png.blob.type, head: await head(png.blob) },
        jpg: { w: jpg.w, h: jpg.h, name: jpg.name, format: jpg.format, type: jpg.blob.type, head: await head(jpg.blob), size: jpg.blob.size, pngSize: png.blob.size },
      };
    });
    expect(out).toMatchObject({ preset: 'pin', count: 2, exportScale: 2 });
    expect(out.png).toMatchObject({ w: 2000, h: 3000, name: 'layout-stage-pinterest-2000x3000.png', format: 'png', type: 'image/png' });
    expect(out.png.head.slice(0, 8)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(Buffer.from(out.png.head))).toEqual([2000, 3000]);
    expect(out.jpg).toMatchObject({ w: 2000, h: 3000, name: 'layout-stage-pinterest-2000x3000.jpg', format: 'jpg', type: 'image/jpeg' });
    expect(out.jpg.head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
    expect(out.jpg.size).toBeLessThan(out.jpg.pngSize);
  });

  test('a custom 6000 × 4000 canvas at 2× is capped at 8000 px on the long side', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      const LS = window.__layoutStage!;
      const st = LS.store.getState();
      st.setPreset('custom');
      LS.store.getState().setCustomSize(6000, 4000);
      LS.store.getState().setCount(1);
      LS.store.getState().pickSolid('#FFFFFF');
      LS.store.getState().editBackground({ grain: 0 });
      const r = await LS.exportComposition(LS.store.getState().doc, 'jpg', 2);
      return { w: r.w, h: r.h, name: r.name };
    });
    expect(out).toEqual({ w: 8000, h: 5333, name: 'layout-stage-custom-8000x5333.jpg' });
  });
});
