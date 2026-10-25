/* The media gallery through the UI: uploads past three wait in Media, a tile goes into the selected
   layout or the layout it's dropped on, unused images can be removed, and the gallery is kept with the
   canvas across a reload. */
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

const getDoc = (page: Page) => page.evaluate(() => window.__layoutStage!.store.getState().doc as Composition);
const names = (d: Composition) => d.slots.slice(0, d.count).map((s) => s.name);

/** Plain PNG pages of different colors, made in the page (the suite runs offline). */
async function pngs(page: Page, colors: string[]) {
  const urls = await page.evaluate((cs) => cs.map((c) => {
    const cv = document.createElement('canvas');
    cv.width = 720;
    cv.height = 1800;
    const g = cv.getContext('2d')!;
    g.fillStyle = c;
    g.fillRect(0, 0, 720, 1800);
    g.fillStyle = '#111';
    g.fillRect(60, 60, 400, 60);
    return cv.toDataURL('image/png');
  }), colors);
  return urls.map((u, k) => ({ name: `page-${k + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(u.split(',')[1], 'base64') }));
}

test('the media gallery keeps every image added and puts any of them in a layout', async ({ page }) => {
  await openEditor(page);
  const media = page.getByRole('list', { name: 'Media' });
  await expect(page.locator('#mediaCount')).toHaveText('0 of 12');

  // Four uploads: three layouts, the fourth waits in Media.
  await page.setInputFiles('#fileMany', await pngs(page, ['#F2E8DA', '#DCE8F5', '#E3F2E1', '#F5DCE4']));
  await expect(page.locator('#mediaCount')).toHaveText('4 of 12');
  expect(names(await getDoc(page))).toEqual(['page-1.png', 'page-2.png', 'page-3.png']);
  await expect(media.getByRole('button', { name: /^page-\d\.png:/ })).toHaveCount(4);

  // Layout 2 selected: the fourth page goes there, and its tile is the current one.
  await page.getByRole('button', { name: 'Select layout 2' }).click();
  await media.getByRole('button', { name: 'page-4.png: put in layout 2' }).click();
  expect(names(await getDoc(page))).toEqual(['page-1.png', 'page-4.png', 'page-3.png']);
  await expect(media.getByRole('button', { name: /^page-4\.png:/ })).toHaveAttribute('aria-current', 'true');

  // Only images no layout shows can be removed.
  await expect(media.getByRole('button', { name: 'Remove page-1.png from media' })).toHaveCount(0);
  await media.getByRole('button', { name: 'Remove page-2.png from media' }).click();
  await expect(page.locator('#mediaCount')).toHaveText('3 of 12');

  // Add goes to the gallery only; a tile dragged onto a layout on the canvas goes into that layout.
  await page.setInputFiles('#mediaFiles', { ...(await pngs(page, ['#EDE4F7']))[0], name: 'page-5.png' });
  await expect(page.locator('#mediaCount')).toHaveText('4 of 12');
  expect(names(await getDoc(page))).toEqual(['page-1.png', 'page-4.png', 'page-3.png']);
  await media.getByRole('button', { name: /^page-1\.png:/ }).dragTo(page.locator('.shot[data-i="2"]'));
  expect(names(await getDoc(page))).toEqual(['page-1.png', 'page-4.png', 'page-1.png']);

  // Kept with the canvas.
  await page.reload();
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
  await expect(page.locator('#mediaCount')).toHaveText('4 of 12');
  await expect(media.locator('img')).toHaveCount(4);
});
