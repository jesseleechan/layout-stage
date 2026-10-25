/* Taller crops through the UI: the 2:3 and 1:2 chips, dragging a layout's bottom edge to a free
   height (snapping to the canvas bottom), the Height slider, and the export drawing the same frame. */
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

const slot0 = (page: Page) => page.evaluate(() => window.__layoutStage!.store.getState().doc.slots[0] as Composition['slots'][0]);
const height = (s: Composition['slots'][0]) => s.w / (s.crop === 'custom' ? s.ar! : s.crop === '1:2' ? 0.5 : NaN);

test('a layout can be made taller: 1:2, a free height on the canvas, and the Height slider', async ({ page }) => {
  await openEditor(page);
  // A 1440 × 6000 page in layout 1, on the classic cascade.
  await page.evaluate(async () => {
    const LS = window.__layoutStage!;
    const c = document.createElement('canvas');
    c.width = 1440;
    c.height = 6000;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 6000; y += 400) { g.fillStyle = y % 800 ? '#E9F0F7' : '#2F7DE1'; g.fillRect(0, y, 1440, 400); }
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
    await LS.store.getState().addImage({ blob, name: 'long.png', source: { kind: 'file' } }, 0);
    LS.store.getState().setArrangement('classic');
    LS.store.getState().select(0);
  });
  const chips = page.getByRole('group', { name: 'Crop' });
  await chips.getByRole('button', { name: '1:2' }).click();
  expect((await slot0(page)).crop).toBe('1:2');

  // Drag the bottom edge to the canvas bottom: a free height that ends exactly there.
  const handle = (await page.locator('#heightHandle').boundingBox())!;
  const stage = (await page.locator('#stageWrap').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, stage.y + stage.height - 2, { steps: 8 });
  await page.mouse.up();
  let s = await slot0(page);
  expect(s.crop).toBe('custom');
  expect(s.cy + height(s) / 2).toBeCloseTo(1500, 3);
  await expect(page.locator('#cropNote')).toBeVisible();
  await expect(chips.getByRole('button', { pressed: true })).toHaveCount(0);

  // The Height slider: one step shorter, then undo goes back to the drag, then to 1:2.
  await page.locator('#shotH').focus();
  await page.keyboard.press('ArrowLeft');
  s = await slot0(page);
  expect(Math.round(height(s))).toBe(Math.round(await page.locator('#shotH').inputValue().then(Number)));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await slot0(page)).crop).toBe('1:2');
  await page.keyboard.press('Control+y');

  // The export draws the same frame: its pixel at the layout's bottom edge, inside, is the page's.
  const px = await page.evaluate(async () => {
    const LS = window.__layoutStage!;
    const d = LS.store.getState().doc;
    const s = d.slots[0];
    const h = s.w / s.ar!;
    const c = await LS.renderComposition(d, 1);
    const g = c.getContext('2d')!;
    const at = (x: number, y: number) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    return { inside: at(s.cx - s.w / 2 + 20, s.cy + h / 2 - 3), h };
  });
  expect(px.h).toBeGreaterThan(1000);
  expect([[0xE9, 0xF0, 0xF7], [0x2F, 0x7D, 0xE1]]).toContainEqual(px.inside);
});
