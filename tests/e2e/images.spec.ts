/* Image ingest in the browser: images within the storage budget are stored byte for byte, bigger ones
   as a downscaled copy (lib/image-sizing.ts); every image gets a thumbnail stored beside it, the
   panels show thumbnails, and images stored before thumbnails existed get one on first use. */
import { expect, test, type Page } from '@playwright/test';

async function openEditor(page: Page) {
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (r) => r.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** In the page: helpers to make a test image and read the image store. */
async function installHelpers(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__makeImage = async (W: number, H: number, type: string) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#f4b6c2');
      g.addColorStop(1, '#2f6fa7');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      x.fillStyle = '#16161a';
      x.font = `${Math.round(W / 30)}px sans-serif`;
      for (let y = 80; y < H; y += 160) x.fillText(`row ${y}`, 40, y);
      const b = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.9));
      c.width = c.height = 0;
      return b!;
    };
    const idb = <T>(f: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = 'readonly') =>
      new Promise<T>((res, rej) => {
        const r = indexedDB.open('layout-stage-images');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const q = f(r.result.transaction('images', mode).objectStore('images'));
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        };
      });
    w.__idbGet = (key: string) => idb((s) => s.get(key));
    w.__idbPut = (key: string, v: unknown) => idb((s) => s.put(v, key), 'readwrite');
    w.__sizeOf = async (b: Blob) => {
      const bm = await createImageBitmap(b);
      const s = [bm.width, bm.height];
      bm.close();
      return s;
    };
  });
}

type Win = Window & {
  __makeImage(W: number, H: number, type: string): Promise<Blob>;
  __idbGet(key: string): Promise<Blob | undefined>;
  __idbPut(key: string, v: unknown): Promise<unknown>;
  __sizeOf(b: Blob): Promise<[number, number]>;
};

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await installHelpers(page);
});

test('an image within the budget is stored byte for byte, with a thumbnail beside it', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as unknown as Win;
    const LS = window.__layoutStage!;
    const blob = await w.__makeImage(1200, 900, 'image/png');
    await LS.store.getState().addImage({ blob, name: 'small.png', source: { kind: 'file' } }, 0);
    const s = LS.store.getState().doc.slots[0];
    const stored = (await w.__idbGet(s.imageId))!;
    const a = new Uint8Array(await blob.arrayBuffer()), b = new Uint8Array(await stored.arrayBuffer());
    const identical = a.length === b.length && a.every((v, i) => v === b[i]);
    // the thumbnail is made in the background: wait for it
    let thumb: Blob | undefined;
    for (let i = 0; i < 50 && !thumb; i++) {
      thumb = await w.__idbGet('thumb:' + s.imageId);
      if (!thumb) await new Promise((res) => setTimeout(res, 100));
    }
    return { identical, nw: s.nw, nh: s.nh, type: stored.type, thumb: thumb && (await w.__sizeOf(thumb)) };
  });
  expect(r).toMatchObject({ identical: true, nw: 1200, nh: 900, type: 'image/png', thumb: [216, 162] });
});

test('a bigger image is stored downscaled: PNG stays PNG, a JPEG photo stays JPEG', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = window as unknown as Win;
    const LS = window.__layoutStage!;
    const out: Record<string, unknown> = {};
    const png = await w.__makeImage(4000, 3000, 'image/png');
    await LS.store.getState().addImage({ blob: png, name: 'wide.png', source: { kind: 'file' } }, 0);
    let s = LS.store.getState().doc.slots[0];
    let stored = (await w.__idbGet(s.imageId))!;
    out.png = { nw: s.nw, nh: s.nh, crop: s.crop, type: stored.type, size: await w.__sizeOf(stored), thumb: await w.__sizeOf((await w.__idbGet('thumb:' + s.imageId))!) };

    const tall = await w.__makeImage(1000, 20000, 'image/png');
    await LS.store.getState().addImage({ blob: tall, name: 'tall.png', source: { kind: 'file' } }, 1);
    s = LS.store.getState().doc.slots[1];
    stored = (await w.__idbGet(s.imageId))!;
    out.tall = { nw: s.nw, nh: s.nh, size: await w.__sizeOf(stored), thumb: await w.__sizeOf((await w.__idbGet('thumb:' + s.imageId))!) };

    const jpg = await w.__makeImage(6000, 4000, 'image/jpeg');
    await LS.store.getState().setBackgroundFile(new File([jpg], 'photo.jpg', { type: 'image/jpeg' }));
    const bg = LS.store.getState().doc.background;
    stored = (await w.__idbGet(bg.imageId!))!;
    out.jpg = { type: stored.type, size: await w.__sizeOf(stored), smaller: stored.size < jpg.size };
    return out;
  });
  expect(r.png).toEqual({ nw: 2880, nh: 2160, crop: 'full', type: 'image/png', size: [2880, 2160], thumb: [216, 162] });
  expect(r.tall).toEqual({ nw: 819, nh: 16383, size: [819, 16383], thumb: [216, 432] });
  expect(r.jpg).toEqual({ type: 'image/jpeg', size: [2880, 1920], smaller: true });
});

test('the panels show thumbnails, and a reload brings everything back', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as unknown as Win;
    const st = window.__layoutStage!.store.getState();
    await st.addImage({ blob: await w.__makeImage(4000, 3000, 'image/png'), name: 'wide.png', source: { kind: 'file' } }, 0);
    await st.setBackgroundFile(new File([await w.__makeImage(3000, 2000, 'image/jpeg')], 'photo.jpg', { type: 'image/jpeg' }));
  });
  // The layout rows are on the left panel's Mockup tab, the background photo on its Canvas tab.
  const tab = (name: 'Mockup' | 'Canvas') => page.getByRole('button', { name, exact: true }).click();
  const size = (sel: string) =>
    page.evaluate((sel) => {
      const img = document.querySelector<HTMLImageElement>(sel);
      return img && [img.naturalWidth, img.naturalHeight];
    }, sel);
  const thumbs = async () => {
    await tab('Mockup');
    await expect.poll(() => size('.slot[data-i="0"] .slot-thumb')).toEqual([216, 162]);
    await expect.poll(() => size('.shot[data-i="0"] img')).toEqual([2880, 2160]);
    await tab('Canvas');
    await expect.poll(() => size('#bgImgThumb')).toEqual([216, 144]);
  };
  await thumbs();

  const before = await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc));
  await page.reload();
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
  expect(await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc))).toBe(before);
  await thumbs();
});

test('an image stored before thumbnails existed gets one on first use, stored for next time', async ({ page }) => {
  const id = await page.evaluate(async () => {
    const w = window as unknown as Win;
    const LS = window.__layoutStage!;
    // What an older version left behind: the image under its id, no thumbnail.
    const id = 'img_old-0001';
    await w.__idbPut(id, await w.__makeImage(1440, 4000, 'image/png'));
    const d = JSON.parse(JSON.stringify(LS.store.getState().doc));
    Object.assign(d.slots[0], { imageId: id, name: 'old.png', source: { kind: 'file' }, nw: 1440, nh: 4000, crop: '16:10', fy: 0 });
    LS.store.getState().loadComposition(d);
    return id;
  });
  await expect
    .poll(() => page.evaluate(() => {
      const t = document.querySelector<HTMLImageElement>('.slot[data-i="0"] .slot-thumb');
      return t && t.complete ? [t.naturalWidth, t.naturalHeight] : null;
    }))
    .toEqual([216, 432]);
  const stored = await page.evaluate(async (id) => {
    const w = window as unknown as Win;
    const t = await w.__idbGet('thumb:' + id);
    return t ? await w.__sizeOf(t) : null;
  }, id);
  expect(stored).toEqual([216, 432]);
});
