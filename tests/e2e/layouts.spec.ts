/* Layouts through the UI: switching canvas sizes keeps a layout you dragged (and coming back restores
   it), the Arrangement picker starts the layouts over in showcase or classic, and the second showcase
   column can continue the first one's page. */
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

const getDoc = (page: Page) => page.evaluate(() => window.__layoutStage!.store.getState().doc as Composition);
const spots = (d: Composition) => d.slots.slice(0, d.count).map((s) => [s.cx, s.cy, s.w]);

test.describe('layouts', () => {
  test('switching canvas sizes keeps a dragged layout, and coming back restores it', async ({ page }) => {
    await openEditor(page);
    const shot = page.locator('.shot[data-i="0"]');
    const box = (await shot.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const dragged = await getDoc(page);
    expect(dragged.slots[0].cx).not.toBe(288);

    await page.selectOption('#canvasSel', 'etsy43');
    const etsy = await getDoc(page);
    expect([etsy.W, etsy.H]).toEqual([3000, 2250]);
    // Kept, not started over: the two layouts sit as they did, scaled by 1.5.
    expect(etsy.slots[1].cx - etsy.slots[0].cx).toBeCloseTo((dragged.slots[1].cx - dragged.slots[0].cx) * 1.5, 3);
    expect(etsy.slots[1].cy - etsy.slots[0].cy).toBeCloseTo((dragged.slots[1].cy - dragged.slots[0].cy) * 1.5, 3);

    await page.selectOption('#canvasSel', 'pin');
    expect(spots(await getDoc(page))).toEqual(spots(dragged));
    // One undo step per switch.
    await page.keyboard.press('Control+z');
    expect((await getDoc(page)).W).toBe(3000);
  });

  test('the Arrangement picker starts the layouts over in classic or showcase', async ({ page }) => {
    await openEditor(page);
    const group = page.getByRole('group', { name: 'Arrangement' });
    await expect(group.getByRole('button', { name: 'Columns' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Cascade' }).click();
    let d = await getDoc(page);
    expect(d.arrangement).toBe('classic');
    expect(d.slots.slice(0, 2).map((s) => s.crop)).toEqual(['16:10', '16:10']);
    await page.getByRole('group', { name: 'Number of layouts' }).getByRole('button', { name: '3' }).click();
    await expect(group.getByRole('button', { name: 'Cascade' })).toHaveAttribute('aria-pressed', 'true');
    await group.getByRole('button', { name: 'Editorial' }).click();
    d = await getDoc(page);
    expect(d.arrangement).toBe('showcase');
    expect(d.slots.map((s) => s.crop)).toEqual(['full', 'full', 'full']);
    expect(d.order).toEqual([1, 2, 0]);
    await page.getByRole('group', { name: 'Number of layouts' }).getByRole('button', { name: '1' }).click();
    await expect(group.getByRole('button', { name: 'Scroll' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the second column can continue the first one’s page', async ({ page }) => {
    await openEditor(page);
    // The samples fit in one column: nothing to continue.
    await page.getByRole('button', { name: 'Replace layout 2' }).click();
    await expect(page.getByRole('menuitem', { name: 'Upload a file…' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Continue layout 1’s page' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // A long page (the three samples one under the other, 1440 × 7680) in layout 1.
    await page.evaluate(async () => {
      const LS = window.__layoutStage!;
      const base = LS.store.getState().doc;
      const slot = (k: number) => ({ ...base.slots[k], crop: 'full' as const, cx: 720, cy: 1280 + 2560 * k, w: 1440 });
      const tall: Composition = { ...base, preset: 'custom', W: 1440, H: 7680, count: 3, arrangement: 'classic', slots: [slot(0), slot(1), slot(2)], order: [0, 1, 2], overlays: undefined };
      const c = await LS.renderComposition(tall, 1);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
      if (!(await LS.store.getState().addImage({ blob, name: 'long.png', source: { kind: 'file' } }, 0))) throw new Error('addImage failed');
    });
    await page.getByRole('button', { name: 'Replace layout 2' }).click();
    await page.getByRole('menuitem', { name: 'Continue layout 1’s page' }).click();
    const d = await getDoc(page);
    expect(d.slots[1].imageId).toBe(d.slots[0].imageId);
    // The column above runs off the top of the canvas: it shows the rest of the page.
    expect(d.slots[1].cy).toBeLessThan(d.slots[0].cy);
    await page.getByRole('button', { name: 'Replace layout 2' }).click();
    await expect(page.getByRole('menuitem', { name: 'Continue layout 1’s page' })).toHaveCount(0);
  });
});
