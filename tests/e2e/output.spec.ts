/* Output features through the UI: the Export menu, Export all sizes and the Etsy listing set (the
   downloaded zips are read back here), Copy, and Match site colors on a light and a dark site. */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function openEditor(page: Page) {
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (r) => r.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** Entries of a stored zip: name and the PNG size from each file's IHDR. */
function readZip(buf: Buffer): { name: string; method: number; w: number; h: number }[] {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    expect(buf.readUInt32BE(data)).toBe(0x89504e47); // PNG
    out.push({ name, method: buf.readUInt16LE(p + 10), w: buf.readUInt32BE(data + 16), h: buf.readUInt32BE(data + 20) });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

async function runFromMenu(page: Page, item: string): Promise<Buffer> {
  await page.focus('#exportMenuBtn');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#exportMenu')).toBeVisible();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
  const saveAll = page.locator('a#sheetSaveAll');
  await expect(saveAll).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), saveAll.click()]);
  const buf = readFileSync(await dl.path());
  expect(dl.suggestedFilename()).toBe(await saveAll.getAttribute('download'));
  return buf;
}

test.describe('export menu', () => {
  test('opens from the keyboard and Esc returns focus without touching the canvas', async ({ page }) => {
    await openEditor(page);
    const before = await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc));
    await page.focus('#exportMenuBtn');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /^Export/ }).first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /Export all sizes/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#exportMenu')).toHaveCount(0);
    await expect(page.locator('#exportMenuBtn')).toBeFocused();
    expect(await page.evaluate(() => JSON.stringify(window.__layoutStage!.store.getState().doc))).toBe(before);
  });
});

test.describe('multi-image export', () => {
  test('Export all sizes: pin at 2:3 and 9:16, Etsy 4:3 and Etsy square in one zip', async ({ page }) => {
    await openEditor(page);
    const zip = await runFromMenu(page, 'Export all sizes');
    expect(readZip(zip)).toEqual([
      { name: 'layout-stage-pinterest-2000x3000.png', method: 0, w: 2000, h: 3000 },
      { name: 'layout-stage-pinterest-9x16-1080x1920.png', method: 0, w: 1080, h: 1920 },
      { name: 'layout-stage-etsy-4x3-3000x2250.png', method: 0, w: 3000, h: 2250 },
      { name: 'layout-stage-etsy-square-2000x2000.png', method: 0, w: 2000, h: 2000 },
    ]);
    await expect(page.locator('#sheetTitle')).toHaveText('All sizes');
    await expect(page.locator('.multi-item a.btn')).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toHaveCount(0);
    await expect(page.locator('#exportMenuBtn')).toBeFocused();
  });

  test('Etsy listing set: hero, three sections and a palette card, numbered', async ({ page }) => {
    await openEditor(page);
    const zip = await runFromMenu(page, 'Etsy listing set');
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      '01-layout-stage-etsy-hero-3000x2250.png',
      '02-layout-stage-etsy-top-3000x2250.png',
      '03-layout-stage-etsy-middle-3000x2250.png',
      '04-layout-stage-etsy-bottom-3000x2250.png',
      '05-layout-stage-etsy-palette-3000x2250.png',
    ]);
    entries.forEach((e) => expect([e.w, e.h]).toEqual([3000, 2250]));
  });
});

test.describe('copy', () => {
  test('copies the export as PNG, also when the export is a JPG', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openEditor(page);
    await page.selectOption('#fmtSel', 'jpg');
    await page.selectOption('#scaleSel', '1');
    await page.click('#exportBtn');
    await page.click('#sheetCopy');
    await expect(page.locator('#sheetToast')).toHaveText('Copied.');
    const got = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const bmp = await createImageBitmap(await item.getType('image/png'));
      return { types: item.types, w: bmp.width, h: bmp.height };
    });
    expect(got).toEqual({ types: ['image/png'], w: 1000, h: 1500 });
  });
});

test.describe('match site colors', () => {
  const lightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };

  test('light site → light mesh, then gradient and solid, one undo step each; dark site → dark', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Canvas', exact: true }).click(); // the left panel's Canvas tab
    const bg = () => page.evaluate(() => window.__layoutStage!.store.getState().doc.background);
    await page.evaluate(() => window.__layoutStage!.store.getState().select(0)); // Juniper: light
    const types: string[] = [];
    for (let i = 0; i < 3; i++) {
      const before = JSON.stringify(await bg());
      await page.click('#matchSiteBtn');
      await page.waitForFunction((b) => JSON.stringify(window.__layoutStage!.store.getState().doc.background) !== b, before);
      types.push((await bg()).type);
    }
    expect(types).toEqual(['mesh', 'gradient', 'solid']);
    expect(lightness((await bg()).solid)).toBeGreaterThan(0.85);
    await page.evaluate(() => { const s = window.__layoutStage!.store.getState(); s.undo(); s.undo(); });
    expect((await bg()).type).toBe('mesh');

    await page.evaluate(() => window.__layoutStage!.store.getState().select(1)); // Northbeam: dark
    const light = JSON.stringify(await bg());
    await page.click('#matchSiteBtn');
    await page.waitForFunction((b) => JSON.stringify(window.__layoutStage!.store.getState().doc.background) !== b, light);
    const dark = await bg();
    expect(dark.type).toBe('mesh');
    expect(lightness(dark.mesh[0])).toBeLessThan(0.15);
    dark.mesh.slice(1).forEach((g) => expect(lightness(g)).toBeLessThan(0.5));
    await expect(page.locator('#toast')).toContainText('layout 2');
  });
});
