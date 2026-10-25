/* URL capture through the real route and dialog. Offline by default; CAPTURE_ONLINE=1 also
   captures a real public page (needs internet access). */
import { expect, test } from '@playwright/test';

const PUBLIC_ONLY = 'Only public web addresses can be captured.';

test.describe('POST /api/capture', () => {
  for (const url of ['http://localhost', 'http://192.168.1.1', 'http://169.254.169.254', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/']) {
    test(`refuses ${url}`, async ({ request }) => {
      const res = await request.post('/api/capture', { data: { url } });
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ code: 'private', message: PUBLIC_ONLY });
    });
  }

  test('refuses other schemes and bad bodies', async ({ request }) => {
    const ftp = await request.post('/api/capture', { data: { url: 'ftp://example.com/' } });
    expect(ftp.status()).toBe(400);
    expect((await ftp.json()).code).toBe('invalid_url');
    const junk = await request.post('/api/capture', { data: 'nope', headers: { 'Content-Type': 'application/json' } });
    expect(junk.status()).toBe(400);
    expect((await junk.json()).code).toBe('bad_request');
  });

  test('refuses requests other sites could send', async ({ request }) => {
    const body = JSON.stringify({ url: 'https://example.com', width: 1440, fullPage: false, scale: 1, delayMs: 0, hideBanners: true });
    const plain = await request.post('/api/capture', { data: body, headers: { 'Content-Type': 'text/plain' } });
    expect(plain.status()).toBe(400);
    const cross = await request.post('/api/capture', { data: body, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' } });
    expect(cross.status()).toBe(400);
  });
});

test.describe('capture dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated);
  });

  test('opens with the defaults, checks the address and closes on Esc', async ({ page }) => {
    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(null));
    const dialog = page.getByRole('dialog', { name: 'Capture from URL' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Web address')).toBeFocused();
    await expect(dialog.getByRole('button', { name: /Desktop/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Full page' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Hide cookie banners')).toBeChecked();

    await dialog.getByLabel('Web address').fill('192.168.1.1');
    await dialog.getByRole('button', { name: 'Capture' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(PUBLIC_ONLY);
    expect(await page.evaluate(() => window.__layoutStage!.store.getState().captureJobs.length)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('names the replace target', async ({ page }) => {
    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(1));
    await expect(page.getByRole('dialog', { name: 'Replace layout 2 from URL' })).toBeVisible();
  });

  test('captures a public page into a layout', async ({ page }) => {
    test.skip(!process.env.CAPTURE_ONLINE, 'set CAPTURE_ONLINE=1 to capture a real page');
    test.setTimeout(150_000);
    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(null));
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Web address').fill('example.com');
    await dialog.getByRole('button', { name: 'Capture' }).click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });
    const slot = await page.evaluate(() => {
      const { doc } = window.__layoutStage!.store.getState();
      return doc.slots.find((s) => s.source.kind === 'url');
    });
    expect(slot?.name).toBe('example.com');
    expect(slot?.source).toMatchObject({ kind: 'url', url: 'https://example.com', options: { width: 1440, fullPage: true, scale: 2 } });
    expect(slot?.nw).toBe(2880);
  });
});
