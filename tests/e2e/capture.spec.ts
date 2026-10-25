/* URL capture through the real route and dialog. Offline by default (the page itself always is, see
   ./local); CAPTURE_ONLINE=1 also captures a real public page (the server needs internet access). */
import { expect, test } from './local';

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

  test('refuses bad hide-elements input and credentials before opening anything', async ({ request }) => {
    const post = (data: object) => request.post('/api/capture', { data: { url: 'https://example.com', ...data } });
    const sel = await post({ hideSelectors: ['#chat', '</style><script>alert(1)</script>'] });
    expect(sel.status()).toBe(400);
    expect((await sel.json()).code).toBe('bad_selectors');
    const auth = await post({ auth: { username: 'a:b', password: 'x' } });
    expect(auth.status()).toBe(400);
    expect((await auth.json()).code).toBe('bad_auth');
    const inUrl = await request.post('/api/capture', { data: { url: 'https://jesse:pw@example.com/' } });
    expect(inUrl.status()).toBe(400);
    expect(await inUrl.json()).toEqual({ code: 'invalid_url', message: 'Put the username and password under Password-protected site, not in the address.' });
  });

  test('the pages route refuses internal sites and bad bodies too', async ({ request }) => {
    const res = await request.post('/api/pages', { data: { url: 'http://localhost' } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ code: 'private', message: PUBLIC_ONLY });
    const junk = await request.post('/api/pages', { data: 'nope', headers: { 'Content-Type': 'application/json' } });
    expect((await junk.json()).code).toBe('bad_request');
    const cross = await request.post('/api/pages', { data: { url: 'https://example.com' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(cross.status()).toBe(400);
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
    await expect(dialog.getByLabel('Dark mode')).not.toBeChecked();
    await expect(dialog.getByLabel('Hide elements')).toHaveValue('');
    await expect(dialog.getByLabel('Username')).toBeHidden(); // Password-protected site starts collapsed

    await dialog.getByLabel('Web address').fill('192.168.1.1');
    await dialog.getByRole('button', { name: 'Capture' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(PUBLIC_ONLY);
    expect(await page.evaluate(() => window.__layoutStage!.store.getState().captureJobs.length)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('checks hide-elements selectors and moves credentials out of the address', async ({ page }) => {
    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(null));
    const dialog = page.getByRole('dialog', { name: 'Capture from URL' });
    await dialog.getByLabel('Web address').fill('example.com');
    await dialog.getByLabel('Hide elements').fill('#chat\n.promo { display: block }');
    await dialog.getByRole('button', { name: 'Capture', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/^“\.promo \{ display: block \}” isn’t a CSS selector\./);
    await expect(dialog.getByLabel('Hide elements')).toBeFocused();
    await dialog.getByLabel('Web address').fill('https://jesse:s3cret@192.168.1.1/');
    await dialog.getByLabel('Hide elements').fill('#chat');
    await dialog.getByRole('button', { name: 'Capture', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(PUBLIC_ONLY);
    await expect(dialog.getByLabel('Web address')).toHaveValue('https://192.168.1.1/');
    await expect(dialog.getByLabel('Username')).toHaveValue('jesse');
    await expect(dialog.getByLabel('Password')).toHaveValue('s3cret');
    expect(await page.evaluate(() => window.__layoutStage!.store.getState().captureJobs.length)).toBe(0);
  });

  test('names the replace target', async ({ page }) => {
    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(1));
    await expect(page.getByRole('dialog', { name: 'Replace layout 2 from URL' })).toBeVisible();
  });

  test('captures a whole site’s pages into Media (pages and captures served by stand-ins)', async ({ page }) => {
    const site = 'https://studio.example';
    await page.route('**/api/pages', (route) =>
      route.fulfill({
        json: {
          pages: [
            { url: `${site}/`, title: 'Home', nav: true },
            { url: `${site}/about`, title: 'About', nav: true },
            { url: `${site}/work`, title: 'Work', nav: true },
            { url: `${site}/contact`, title: 'Contact', nav: true },
            { url: `${site}/journal/hello`, title: 'Hello', nav: false },
          ],
        },
      }),
    );
    // Each capture is a small PNG; the first waits until the test has seen the pending tiles.
    const png = Buffer.from(await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 360;
      c.height = 900;
      c.getContext('2d')!.fillRect(0, 0, 360, 900);
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    let n = 0;
    await page.route('**/api/capture', async (route) => {
      const body = route.request().postDataJSON() as { url: string };
      if (n++ === 0) await held;
      await route.fulfill({ body: png, headers: { 'Content-Type': 'image/png', 'X-Capture-Trimmed': '0', 'X-Capture-Url': body.url } });
    });

    await page.evaluate(() => window.__layoutStage!.store.getState().openCapture(null));
    const dialog = page.getByRole('dialog', { name: 'Capture from URL' });
    await dialog.getByRole('button', { name: 'Whole site' }).click();
    await expect(dialog.getByRole('button', { name: /^Both/ })).toHaveCount(0);
    await dialog.getByLabel('Web address').fill('studio.example');
    await dialog.getByRole('button', { name: 'Find pages' }).click();
    // The menu pages are ticked to start.
    await expect(dialog.locator('#sitePickCount')).toHaveText('4 of 5');
    await expect(dialog.getByRole('checkbox', { name: /Hello/ })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: /Contact/ }).uncheck();
    await dialog.getByRole('button', { name: 'Capture 3 pages' }).click();
    await expect(dialog).toBeHidden();

    const media = page.getByRole('list', { name: 'Media' });
    await expect(media.getByRole('img', { name: /^Capturing/ })).toHaveCount(3);
    release();
    await expect(page.locator('#mediaCount')).toHaveText('3 of 12', { timeout: 20_000 });
    await expect(media.getByRole('img', { name: /^Capturing/ })).toHaveCount(0);
    const doc = await page.evaluate(() => window.__layoutStage!.store.getState().doc);
    // The two sample layouts take the first two pages; the third waits in Media.
    expect(doc.slots.slice(0, doc.count).map((s) => s.name)).toEqual(['studio.example', 'studio.example/about']);
    expect(doc.media!.map((m) => m.name)).toEqual(['studio.example', 'studio.example/about', 'studio.example/work']);
    expect(doc.media![2].source).toMatchObject({ kind: 'url', url: `${site}/work` });
    await expect(page.locator('#toast')).toHaveText('Captured 3 pages into Media.');
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

test.describe('layout rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated);
  });

  /** Makes layouts 1 and 2 look captured from a URL (layout 2 with a password). */
  const fromUrl = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const st = window.__layoutStage!.store.getState();
      const options = { width: 1440, fullPage: true, scale: 2, delayMs: 1500, hideBanners: true, darkMode: false, hideSelectors: [] } as const;
      st.change((d) => {
        d.slots[0].source = { kind: 'url', url: 'https://example.com/pricing', capturedAt: '2026-10-01T00:00:00.000Z', options: { ...options, hideSelectors: [] } };
        d.slots[1].source = { kind: 'url', url: 'https://staging.example.com/', capturedAt: '2026-10-01T00:00:00.000Z', options: { ...options, hideSelectors: ['#chat'] }, needsPassword: true };
      });
    });

  test('one Replace menu per row, by keyboard', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Replace layout 1' });
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Replace layout 1' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Upload a file…', 'Capture from URL…']);
    await expect(menu.getByRole('menuitem', { name: 'Upload a file…' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Capture from URL…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Replace layout 1 from URL' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  });

  test('captured layouts offer Re-capture; a password page asks for the password again', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Re-capture all' })).toBeHidden();
    await fromUrl(page);
    await expect(page.getByRole('button', { name: 'Re-capture all' })).toBeVisible();
    await page.getByRole('button', { name: 'Replace layout 2' }).click();
    await page.getByRole('menuitem', { name: 'Re-capture staging.example.com' }).click();
    const dialog = page.getByRole('dialog', { name: 'Re-capture layout 2' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Web address')).toHaveValue('https://staging.example.com/');
    await expect(dialog.getByLabel('Hide elements')).toHaveValue('#chat');
    await expect(dialog.getByLabel('Username')).toBeFocused();
    await expect(dialog.getByLabel('Password')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Re-capture', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter the username and password for this page. They aren’t saved.');
    expect(await page.evaluate(() => window.__layoutStage!.store.getState().captureJobs.length)).toBe(0);
  });
});
