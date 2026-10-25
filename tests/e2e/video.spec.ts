/* Scrolling video and pin text through the UI. The video is rendered from the Export menu, saved, read
   back as an MP4 (box layout, duration, frame count, keyframes) and played in a <video> element: its
   length and size are exact, it seeks, and a frame matches the still export at the same scroll
   position better than the frames beside it. Pin text: suggested, edited (one undo step), reset,
   copied and kept with the canvas across a reload. */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { framePlanFor, scrollAtFrame } from '../../lib/video/timing';
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

    const got = await page.evaluate(
      async ({ b64, fys, mid }) => {
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
        for (const fy of fys) {
          const d = JSON.parse(JSON.stringify(LS.store.getState().doc));
          d.slots[0].fy = fy;
          const c = await LS.renderComposition(d, 1080 / 1500);
          const B = c.getContext('2d')!.getImageData(0, 0, w, h).data;
          let se = 0;
          for (let k = 0; k < A.length; k += 4) for (let ch = 0; ch < 3; ch++) se += (A[k + ch] - B[k + ch]) ** 2;
          psnr.push(10 * Math.log10((255 * 255) / (se / ((A.length / 4) * 3))));
        }
        await seek(5.9);
        return { duration: v.duration, w, h, seekable: v.seekable.length === 1 && v.seekable.end(0) === v.duration, at: v.currentTime, psnr };
      },
      { b64: buf.toString('base64'), fys, mid },
    );
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

  test('Cancel stops the render and keeps the settings', async ({ page }) => {
    await openEditor(page);
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
