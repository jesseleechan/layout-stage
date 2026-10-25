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

test('a zoom callout: the canvas shows the same magnified window as the export', async ({ page }) => {
  await openEditor(page);
  // A page of big colored blocks, so the window's place shows in the pixels.
  await page.evaluate(async () => {
    const LS = window.__layoutStage!;
    const c = document.createElement('canvas');
    c.width = 1440;
    c.height = 4000;
    const g = c.getContext('2d')!;
    const colors = ['#E94F37', '#3F88C5', '#F6AE2D', '#2E933C', '#7B2D8E', '#1B1B1E'];
    for (let y = 0; y < 4000; y += 400) for (let x = 0; x < 1440; x += 360) {
      g.fillStyle = colors[(x / 360 + y / 400) % colors.length];
      g.fillRect(x, y, 360, 400);
    }
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
    await LS.store.getState().addImage({ blob, name: 'blocks.png', source: { kind: 'file' } }, 0);
    const S = LS.store.getState();
    S.setArrangement('classic');
    S.addCallout(0);
    S.setZoom(2, 2.5);
    S.setWindow(2, { fx: 30, fy: 40 });
    S.commit();
    S.select(null);
  });
  await expect(page.locator('#calloutBtn')).toHaveCount(0); // nothing selected
  const shot = page.locator('.shot[data-i="2"]');
  await expect(shot.locator('img')).toHaveJSProperty('complete', true);
  const png = (await shot.screenshot()).toString('base64');
  const diff = await page.evaluate(async (b64) => {
    const LS = window.__layoutStage!;
    const { doc, scale } = LS.store.getState();
    const s = doc.slots[2];
    const h = s.w / (4 / 3);
    const exp = await LS.renderComposition(doc, scale);
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    // The middle 60% of the callout, in the export and in the screenshot.
    const w = img.naturalWidth, hh = img.naturalHeight;
    const a = document.createElement('canvas');
    a.width = w;
    a.height = hh;
    const ax = a.getContext('2d')!;
    ax.drawImage(img, 0, 0);
    const b = document.createElement('canvas');
    b.width = w;
    b.height = hh;
    const bx = b.getContext('2d')!;
    bx.drawImage(exp, (s.cx - s.w / 2) * scale, (s.cy - h / 2) * scale, s.w * scale, h * scale, 0, 0, w, hh);
    const x0 = Math.round(w * 0.2), y0 = Math.round(hh * 0.2), cw = Math.round(w * 0.6), ch = Math.round(hh * 0.6);
    const A = ax.getImageData(x0, y0, cw, ch).data, B = bx.getImageData(x0, y0, cw, ch).data;
    let sum = 0;
    for (let k = 0; k < A.length; k += 4) sum += Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]);
    return sum / (A.length / 4) / 3;
  }, png);
  expect(diff).toBeLessThan(6);
});
