/* Scrolling video and pin text through the UI. The video is rendered from the Export menu, saved, read
   back as an MP4 (box layout, duration, frame count, keyframes) and played in a <video> element: its
   length and size are exact, it seeks, and a frame matches the still export at the same scroll
   position better than the frames beside it. Pin text: suggested, edited (one undo step), reset,
   copied and kept with the canvas across a reload. */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { framePlanFor, scrollAtFrame, slotAtFrame } from '../../lib/video/timing';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

async function openVideoSheet(page: Page) {
  await page.focus('#exportMenuBtn');
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menuitem', { name: /Scrolling video/ }).click();
  await expect(page.locator('#sheetTitle')).toHaveText('Scrolling video');
}

/** Starts from the classic arrangement: the samples at 16:10, so each one scrolls inside its frame. */
async function classic(page: Page) {
  await page.evaluate(() => window.__layoutStage!.store.getState().setArrangement('classic'));
}

/** Plays the MP4 in a <video>, takes frame `mid`, and compares it (PSNR) with the still export of
 *  each of `docs` at the video's size. Also reports the duration, size and whether it seeks. */
async function framePsnr(page: Page, buf: Buffer, mid: number, docs: Composition[]) {
  return page.evaluate(
    async ({ b64, docs, mid }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error(`video error ${v.error?.code}`)); });
      const seek = (t: number) => new Promise((res) => { v.onseeked = res; v.currentTime = t; });
      await seek((mid + 0.5) / 30);
      const { videoWidth: w, videoHeight: h } = v;
      const frame = document.createElement('canvas');
      frame.width = w;
      frame.height = h;
      const fx = frame.getContext('2d', { willReadFrequently: true })!;
      fx.drawImage(v, 0, 0, w, h);
      const A = fx.getImageData(0, 0, w, h).data;
      const LS = window.__layoutStage!;
      const psnr: number[] = [];
      for (const d of docs) {
        const c = await LS.renderComposition(d, w / d.W);
        const B = c.getContext('2d')!.getImageData(0, 0, w, h).data;
        let se = 0;
        for (let k = 0; k < A.length; k += 4) for (let ch = 0; ch < 3; ch++) se += (A[k + ch] - B[k + ch]) ** 2;
        psnr.push(10 * Math.log10((255 * 255) / (se / ((A.length / 4) * 3))));
      }
      await seek(v.duration - 0.1);
      return { duration: v.duration, w, h, seekable: v.seekable.length === 1 && v.seekable.end(0) === v.duration, at: v.currentTime, psnr };
    },
    { b64: buf.toString('base64'), docs, mid },
  );
}

/** Top-level boxes, and a few numbers from the moov. */
function readMp4(buf: Buffer) {
  const top: string[] = [];
  for (let p = 0; p < buf.length; p += buf.readUInt32BE(p)) top.push(buf.toString('latin1', p + 4, p + 8));
  const at = (type: string) => buf.indexOf(Buffer.from(type, 'latin1'));
  const mvhd = at('mvhd') + 4, stsz = at('stsz') + 4, stss = at('stss') + 4, mdhd = at('mdhd') + 4;
  return {
    top,
    movie: { timescale: buf.readUInt32BE(mvhd + 12), duration: buf.readUInt32BE(mvhd + 16) },
    media: { timescale: buf.readUInt32BE(mdhd + 12), duration: buf.readUInt32BE(mdhd + 16) },
    frames: buf.readUInt32BE(stsz + 8),
    keyframes: Array.from({ length: buf.readUInt32BE(stss + 4) }, (_, i) => buf.readUInt32BE(stss + 8 + i * 4)),
    codec: buf.toString('latin1', at('avc1'), at('avc1') + 4) + '/' + buf.toString('latin1', at('avcC'), at('avcC') + 4),
  };
}

test.describe('scrolling video', () => {
  test('renders an exact, seekable MP4 whose frames are the still export', async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    await classic(page);
    await openVideoSheet(page);
    await expect(page.locator('#vidRender')).toBeFocused();
    await expect(page.locator('#vidSlot button').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#vidSlotHint')).toHaveText('Juniper & Co. · scrolls top to bottom');
    await page.locator('#vidSeconds').fill('6');
    await page.locator('#vidHold').fill('0.5');
    await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Steady' }).click();
    await page.getByRole('group', { name: 'Size in pixels' }).getByRole('button', { name: '720 × 1080' }).click();
    await page.click('#vidRender');
    await expect(page.locator('#vidProgress')).toBeVisible();
    await expect(page.locator('#vidSave')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('#vidSave')).toBeFocused();
    await expect(page.locator('#vidName')).toHaveText('layout-stage-pinterest-720x1080-scroll.mp4');
    await expect(page.locator('#vidMeta')).toContainText('720 × 1080 px · 6 s · MP4');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#vidSave')]);
    expect(dl.suggestedFilename()).toBe('layout-stage-pinterest-720x1080-scroll.mp4');
    const buf = readFileSync(await dl.path());
    expect(readMp4(buf)).toEqual({
      top: ['ftyp', 'moov', 'mdat'],
      movie: { timescale: 1000, duration: 6000 },
      media: { timescale: 30000, duration: 180000 },
      frames: 180,
      keyframes: [1, 31, 61, 91, 121, 151],
      codec: 'avc1/avcC',
    });

    // Where the page is on each frame (lib/video/timing.ts, unit tested), from the canvas as it is.
    const doc = await page.evaluate(() => window.__layoutStage!.store.getState().doc as Composition);
    const plan = framePlanFor(doc.slots[0], { seconds: 6, hold: 0.5, easing: 'linear' });
    const mid = 90;
    const fys = [mid - 1, mid, mid + 1].map((i) => scrollAtFrame(plan, i));
    expect(scrollAtFrame(plan, 0)).toBe(0);
    expect(scrollAtFrame(plan, 179)).toBe(100);

    const docs = fys.map((fy) => ({ ...doc, slots: doc.slots.map((s, k) => (k === 0 ? { ...s, fy } : s)) as Composition['slots'] }));
    const got = await framePsnr(page, buf, mid, docs);
    expect(got).toMatchObject({ duration: 6, w: 720, h: 1080, seekable: true, at: 5.9 });
    const [before, at, after] = got.psnr;
    expect(at).toBeGreaterThan(36); // the same picture, give or take video compression
    expect(at).toBeGreaterThan(before + 6); // and the right frame, not its neighbour
    expect(at).toBeGreaterThan(after + 6);

    await page.click('#vidAgain');
    await expect(page.locator('#vidRender')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toHaveCount(0);
    await expect(page.locator('#exportMenuBtn')).toBeFocused();
  });

  test('a whole page running off the canvas slides up through it', async ({ page }) => {
    test.setTimeout(180_000);
    await openEditor(page);
    // Showcase, one layout: the sample page, 800 wide, runs off the bottom of the pin.
    await page.evaluate(() => window.__layoutStage!.store.getState().setCount(1));
    await openVideoSheet(page);
    await expect(page.locator('#vidSlotHint')).toHaveText('Juniper & Co. · slides up through the canvas');
    await page.locator('#vidSeconds').fill('6');
    await page.locator('#vidHold').fill('0');
    await page.getByRole('group', { name: 'Motion' }).getByRole('button', { name: 'Steady' }).click();
    await page.getByRole('group', { name: 'Size in pixels' }).getByRole('button', { name: '720 × 1080' }).click();
    await page.click('#vidRender');
    await expect(page.locator('#vidSave')).toBeVisible({ timeout: 120_000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#vidSave')]);
    const buf = readFileSync(await dl.path());
    expect(readMp4(buf).frames).toBe(180);

    const doc = await page.evaluate(() => window.__layoutStage!.store.getState().doc as Composition);
    const plan = framePlanFor(doc.slots[0], { seconds: 6, hold: 0, easing: 'linear' }, 30, doc.H);
    const mid = 90;
    const docs = [mid - 1, mid, mid + 1].map((i) => ({ ...doc, slots: doc.slots.map((s, k) => (k === 0 ? slotAtFrame(s, plan, i, doc.H) : s)) as Composition['slots'] }));
    expect(docs[1].slots[0].cy).toBeLessThan(doc.slots[0].cy);
    const got = await framePsnr(page, buf, mid, docs);
    expect(got).toMatchObject({ duration: 6, w: 720, h: 1080, seekable: true });
    const [before, at, after] = got.psnr;
    expect(at).toBeGreaterThan(36);
    expect(at).toBeGreaterThan(before + 3);
    expect(at).toBeGreaterThan(after + 3);
  });

  test('Cancel stops the render and keeps the settings', async ({ page }) => {
    await openEditor(page);
    await classic(page);
    await openVideoSheet(page);
    await page.locator('#vidSeconds').fill('15');
    await page.click('#vidRender');
    await expect(page.locator('#vidCancel')).toBeFocused();
    await page.click('#vidCancel');
    await expect(page.locator('#sheetToast')).toHaveText('Cancelled.');
    await expect(page.locator('#vidRender')).toBeFocused();
    await expect(page.locator('#vidSeconds')).toHaveValue('15');
    await expect(page.locator('#vidSave')).toHaveCount(0);
  });

  test('renders in another shape without changing the canvas: Pin 9:16 and Etsy 4:3', async ({ page }) => {
    await openEditor(page);
    await classic(page);
    const before = await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc));
    await openVideoSheet(page);
    const shape = page.getByRole('group', { name: 'Shape' });
    await expect(shape.getByRole('button', { name: 'Pin 2:3' })).toHaveCount(0); // the canvas is a pin already
    await shape.getByRole('button', { name: 'Etsy 4:3' }).click();
    await expect(page.locator('#vidShapeHint')).toContainText('up to 15 seconds');
    await expect(page.getByRole('group', { name: 'Size in pixels' })).toContainText('1920 × 1440');
    await shape.getByRole('button', { name: 'Pin 9:16' }).click();
    await page.getByRole('group', { name: 'Size in pixels' }).getByRole('button', { name: '1080 × 1920' }).click();
    await page.locator('#vidSeconds').fill('6');
    await page.click('#vidRender');
    await expect(page.locator('#vidMeta')).toContainText('1080 × 1920 px · 6 s · MP4', { timeout: 120_000 });
    expect(await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc))).toBe(before);
  });

  test('explains when no layout hides part of its page', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const st = window.__layoutStage!.store.getState();
      for (let i = 0; i < st.doc.count; i++) window.__layoutStage!.store.getState().setCrop(i, 'full');
    });
    await openVideoSheet(page);
    await expect(page.locator('#vidSlotHint')).toContainText('Every layout shows its whole page');
    await expect(page.locator('#vidRender')).toBeDisabled();
    await expect(page.locator('#sheetClose')).toBeFocused();
  });
});

test.describe('pin text', () => {
  test('suggested, edited with one undo step, reset, copied and kept across a reload', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openEditor(page);
    await page.selectOption('#scaleSel', '1');
    await page.click('#exportBtn');
    const title = page.locator('#pin-title');
    await expect(title).toHaveValue('Juniper & Co. and Northbeam — website designs');
    await expect(page.locator('#pin-title-count')).toHaveText('45/100');
    await expect(page.locator('#pin-link')).toHaveValue('');
    await expect(page.locator('#pin-link-copy')).toBeDisabled();

    await title.fill('A calm theme for small brands');
    await expect(page.locator('#pin-title-count')).toHaveText('29/100');
    await title.blur();
    expect(await page.evaluate(() => {
      const s = window.__layoutStage!.store.getState();
      return { pin: s.doc.pin, canUndo: s.canUndo };
    })).toEqual({ pin: { title: 'A calm theme for small brands' }, canUndo: true });

    await page.click('#pin-title-copy');
    await expect(page.locator('#sheetToast')).toHaveText('Title copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('A calm theme for small brands');
    await page.click('#pinCopyAll');
    await expect(page.locator('#sheetToast')).toHaveText('Pin text copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Title: A calm theme for small brands\n\nDescription: 2 website designs: /);

    await page.locator('#pin-description').fill('Mine');
    await page.click('#pin-description-reset');
    await expect(page.locator('#pin-description')).toBeFocused();
    await expect(page.locator('#pin-description')).toHaveValue(/^2 website designs: Juniper & Co\. and Northbeam\./);
    await expect(page.locator('#pin-description-reset')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300); // autosave
    await page.reload();
    await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
    await page.click('#exportBtn');
    await expect(page.locator('#pin-title')).toHaveValue('A calm theme for small brands');
    await expect(page.locator('#pin-title-reset')).toBeVisible();
  });
});
