/* Projects synced across devices, against the app's local project store (.data/sync, or
   PROJECTS_STORE_DIR): two browser contexts are two devices with their own IndexedDB. Sync runs on
   its own schedule; the tests call syncNow() (push everything, then pull) instead of waiting. */
import { expect, test, type Browser, type Page } from '@playwright/test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function device(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Offline like the rest of the suite: a page may only reach the app.
  await context.route((url) => !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('blockedbyclient'));
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForFunction(() => {
    const p = window.__layoutProjects?.getState();
    return window.__layoutStage?.store.getState().hydrated === true && !!p && p.items.length > 0 && p.mode != null;
  }, null, { timeout: 45_000 });
  return page;
}

const sync = (page: Page) => page.evaluate(() => window.__layoutProjects!.getState().syncNow());
const current = (page: Page) =>
  page.evaluate(() => {
    const s = window.__layoutProjects!.getState();
    const p = s.items.find((x) => x.id === s.currentId)!;
    return { id: p.id, name: p.name, dirty: p.dirty };
  });
const names = (page: Page) => page.evaluate(() => window.__layoutProjects!.getState().items.map((p) => p.name));
const solid = (page: Page) => page.evaluate(() => window.__layoutStage!.store.getState().doc.background.solid);
const pick = (page: Page, color: string) => page.evaluate((c) => window.__layoutStage!.store.getState().pickSolid(c), color);

/** SHA-256 of the image stored under an id in this device's IndexedDB. */
const storedHash = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const blob = await new Promise<Blob>((res, rej) => {
      const r = indexedDB.open('layout-stage-images');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const q = r.result.transaction('images').objectStore('images').get(id);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      };
    });
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }, id);

test.beforeEach(async ({ request }) => {
  const listing = await (await request.get('/api/projects')).json();
  test.skip(listing.sync === 'off', 'This server has no project store (PROJECTS_STORE_DIR=off).');
});

test('a project made on one device opens on another, edits and conflicts sync, delete removes it everywhere', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const name = `E2E trip ${Date.now().toString(36)}`;
  const A = await device(browser, baseURL);
  const B = await device(browser, baseURL);

  // A: rename the open project from the top bar, and add a ~9 MB image (noise doesn't compress).
  await A.locator('#projectName').click();
  const field = A.getByRole('textbox', { name: 'Project name' });
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press('Enter');
  await expect(A.locator('#projectName')).toHaveText(name);
  const added = await A.evaluate(async () => {
    const W = 1800, H = 1800;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d')!;
    const img = x.createImageData(W, H);
    const rnd = new Uint8Array(W * 4);
    for (let row = 0; row < H; row++) {
      crypto.getRandomValues(rnd);
      for (let i = 0; i < W * 4; i += 4) img.data.set([rnd[i], rnd[i + 1], rnd[i + 2], 255], row * W * 4 + i);
    }
    x.putImageData(img, 0, 0);
    const blob = (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png')))!;
    await window.__layoutStage!.store.getState().addImage({ blob, name: 'noise.png', source: { kind: 'file' } }, 0);
    return { id: window.__layoutStage!.store.getState().doc.slots[0].imageId, size: blob.size };
  });
  expect(added.size).toBeGreaterThan(8 * 1024 * 1024);
  const bodies: number[] = [];
  A.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/files/images/')) bodies.push(Number(r.headers()['content-length'] || 0));
  });
  await sync(A);
  await expect(A.locator('.proj-status-text')).toHaveText('Synced');
  // Every upload request stays under Vercel's 4.5 MB body limit.
  expect(bodies.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...bodies)).toBeLessThanOrEqual(4 * 1024 * 1024);
  const { id } = await current(A);

  // B: the project is listed; opening it downloads the image first.
  await sync(B);
  await B.locator('#projectsBtn').click();
  const sheet = B.getByRole('dialog', { name: 'Projects' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(name, { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(B.locator('#projectName')).toHaveText(name);
  expect(await B.evaluate(() => window.__layoutStage!.store.getState().doc.slots[0].imageId)).toBe(added.id);
  expect(await storedHash(B, added.id)).toBe(await storedHash(A, added.id));
  await expect.poll(() => B.evaluate(() => document.querySelector<HTMLImageElement>('.shot[data-i="0"] img')?.naturalWidth ?? 0)).toBe(1800);
  expect(await B.evaluate(() => window.__layoutStage!.store.getState().canUndo)).toBe(false);

  // An edit on B shows up on A, with a fresh undo history there.
  await pick(B, '#123456');
  await sync(B);
  await sync(A);
  expect(await solid(A)).toBe('#123456');
  expect(await A.evaluate(() => window.__layoutStage!.store.getState().canUndo)).toBe(false);
  await expect(A.locator('.toast')).toHaveText('Updated from another device.');

  // Both change the same project: B syncs first, A keeps its version as a new project.
  await pick(A, '#AA0000');
  await pick(B, '#0000BB');
  await sync(B);
  await sync(A);
  expect(await current(A)).toMatchObject({ name: `${name} (this device)` });
  expect(await solid(A)).toBe('#AA0000');
  expect(await names(A)).toEqual(expect.arrayContaining([name, `${name} (this device)`]));
  await sync(B);
  expect(await current(B)).toMatchObject({ id, name });
  expect(await solid(B)).toBe('#0000BB');
  expect(await names(B)).toContain(`${name} (this device)`);
  const forkId = (await current(A)).id;

  // Delete both from A's list (each asks first).
  await A.locator('#projectsBtn').click();
  const list = A.getByRole('dialog', { name: 'Projects' });
  for (const n of [`${name} (this device)`, name]) {
    await list.getByRole('button', { name: `Delete ${n}`, exact: true }).click();
    await expect(list.getByText(`Delete “${n}” from all your devices?`)).toBeVisible();
    await list.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(list.getByText(n, { exact: true })).toBeHidden();
  }
  await A.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await sync(A);
  for (const pid of [id, forkId]) {
    expect((await A.request.get(`/api/projects/${pid}`)).status()).toBe(404);
  }
  expect((await A.request.get(`/api/projects/${id}/files/images/${added.id}.png`)).status()).toBe(404);
  const listed = (await (await A.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id);
  expect(listed).not.toContain(id);
  expect(listed).not.toContain(forkId);

  // B, which had it open and unchanged, lets it go too.
  await sync(B);
  expect(await names(B)).not.toContain(name);
  expect(await names(B)).not.toContain(`${name} (this device)`);
  expect((await current(B)).id).not.toBe(id);
  await A.context().close();
  await B.context().close();
});

test('the projects list: keyboard, rename, duplicate and a new project', async ({ browser, baseURL }) => {
  const page = await device(browser, baseURL);
  const btn = page.locator('#projectsBtn');
  await btn.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Projects' });
  await expect(sheet).toBeVisible();
  const first = await current(page);
  await expect(sheet.getByRole('button', { name: `Open ${first.name}`, exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(btn).toBeFocused();

  // Rename from the card.
  const name = `List ${Date.now().toString(36)}`;
  await btn.click();
  await sheet.getByRole('button', { name: `Rename ${first.name}`, exact: true }).click();
  const field = sheet.getByRole('textbox', { name: `Rename ${first.name}` });
  await field.fill(name);
  await field.press('Enter');
  await expect(sheet.getByText(name, { exact: true })).toBeVisible();
  await expect(page.locator('#projectName')).toHaveText(name);

  // Duplicate opens the copy; the original stays in the list.
  await pick(page, '#334455');
  await sheet.getByRole('button', { name: `Duplicate ${name}`, exact: true }).click();
  await expect(page.locator('#projectName')).toHaveText(`${name} copy`);
  expect(await solid(page)).toBe('#334455');
  expect(await names(page)).toEqual(expect.arrayContaining([name, `${name} copy`]));

  // New project: the default canvas, no undo history; the copy is kept.
  await btn.click();
  await sheet.getByRole('button', { name: 'New project' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#projectName')).toHaveText(/^Untitled \d+$/);
  expect(await page.evaluate(() => window.__layoutStage!.store.getState().canUndo)).toBe(false);
  expect(await solid(page)).not.toBe('#334455');

  // Back to the copy: its canvas as it was.
  await btn.click();
  await sheet.getByRole('button', { name: `Open ${name} copy`, exact: true }).click();
  await expect(page.locator('#projectName')).toHaveText(`${name} copy`);
  expect(await solid(page)).toBe('#334455');

  // Clean up what this test put in the store.
  await btn.click();
  for (const n of [`${name} copy`, name]) {
    await sheet.getByRole('button', { name: `Delete ${n}`, exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sheet.getByText(n, { exact: true })).toBeHidden();
    await expect(sheet.locator('.proj-open:focus')).toHaveCount(1); // focus stays in the list
  }
  await sync(page);
  await page.context().close();
});

test('the autosave from before projects opens as “Untitled 1”, and other projects keep their images', async ({ browser, baseURL }) => {
  const page = await device(browser, baseURL);
  // What an older version left behind: one autosaved canvas, no project list.
  await page.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(window.__layoutStage!.store.getState().doc));
    Object.assign(d.background, { type: 'solid', solid: '#ABCDEF' });
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open('layout-stage');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('state', 'readwrite');
        const s = tx.objectStore('state');
        s.put(d, 'composition');
        s.delete('projects');
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      };
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true && (window.__layoutProjects?.getState().items.length ?? 0) > 0);
  await expect(page.locator('#projectName')).toHaveText('Untitled 1');
  expect(await solid(page)).toBe('#ABCDEF');
  expect(await page.evaluate(() => window.__layoutProjects!.getState().items.filter((p) => !p.stub).length)).toBe(1);

  // An image in this project survives a reload while another project is open (startup pruning keeps
  // the images of every project in the browser).
  const imageId = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    c.getContext('2d')!.fillRect(0, 0, 400, 300);
    const blob = (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png')))!;
    await window.__layoutStage!.store.getState().addImage({ blob, name: 'keep.png', source: { kind: 'file' } }, 0);
    return window.__layoutStage!.store.getState().doc.slots[0].imageId;
  });
  const kept = await current(page);
  await page.evaluate(() => window.__layoutProjects!.getState().create());
  await expect(page.locator('#projectName')).toHaveText('Untitled 2');
  await sync(page); // let the upload that leaving started finish (a reload would cut it off)
  await page.reload();
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true && (window.__layoutProjects?.getState().items.length ?? 0) > 0);
  await expect(page.locator('#projectName')).toHaveText('Untitled 2');
  await page.waitForTimeout(500); // the startup prune runs in the background
  expect(await storedHash(page, imageId)).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.evaluate((id) => window.__layoutProjects!.getState().open(id), kept.id)).toBe(true);
  expect(await page.evaluate(() => window.__layoutStage!.store.getState().doc.slots[0].imageId)).toBe(imageId);

  await page.evaluate((id) => window.__layoutProjects!.getState().remove(id), kept.id);
  await sync(page);
  await page.context().close();
});

test('a store that keeps refusing a project: the editor tries again less and less often, Sync now at once', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route((url) => !LOCAL_HOSTS.has(url.hostname), (route) => route.abort('blockedbyclient'));
  // The store answers everything except saving a project's canvas.
  let refusing = true;
  let puts = 0;
  await context.route(/\/api\/projects\/prj_[^/]+$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts++;
    if (!refusing) return route.continue();
    return route.fulfill({ status: 502, json: { code: 'store_error', message: 'The project store didn’t answer.' } });
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true && window.__layoutProjects?.getState().mode != null, null, { timeout: 45_000 });

  await pick(page, '#2A6F4E');
  // Ten minutes of editor time: the first push fails after the pause in editing, then retries wait
  // 3 and 6 minutes (they used to come every 30–45 seconds).
  for (let t = 0; t < 40; t++) {
    await page.clock.runFor(15_000);
    await page.waitForTimeout(60);
  }
  expect(puts).toBeGreaterThanOrEqual(2);
  expect(puts).toBeLessThanOrEqual(3);
  await expect(page.locator('.proj-status-text')).toHaveText('Saved on this device');

  // Sync now doesn't wait; once the store takes it, it's synced.
  refusing = false;
  const before = puts;
  await sync(page);
  expect(puts).toBe(before + 1);
  await expect(page.locator('.proj-status-text')).toHaveText('Synced');
  expect((await current(page)).dirty).toBe(false);
  await context.close();
});
