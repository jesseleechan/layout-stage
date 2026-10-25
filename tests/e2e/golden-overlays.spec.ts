/* Headline, badge and watermark (lib/overlays.ts): a golden export with all three, and the preview's
   overlay canvas checked against the export at the same scale. The overlay fonts are bundled in
   public/fonts and the logo is drawn in the page from shapes, so this runs offline like the other
   goldens; the file name keeps it in `npm run test:e2e:update` and the Update goldens workflow. */
import type { Page } from '@playwright/test';
import type { Composition } from '../../lib/model';
import type { Overlays } from '../../lib/overlays';
import { GOLDEN_CASES } from './fixtures';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** Draws a two-tone logo (shapes only, no text) and uploads it as the watermark. Returns its image id. */
async function uploadLogo(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 160;
    const x = c.getContext('2d')!;
    x.fillStyle = '#16161A';
    x.beginPath();
    x.arc(80, 80, 64, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#E8553D';
    x.beginPath();
    x.arc(80, 80, 30, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#16161A';
    x.fillRect(176, 40, 260, 32);
    x.fillRect(176, 92, 180, 28);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    const st = window.__layoutStage!.store;
    await st.getState().setWatermarkLogo(new File([blob], 'logo.png', { type: 'image/png' }));
    const id = st.getState().doc.overlays?.watermark.imageId;
    if (!id) throw new Error('logo upload failed');
    return id;
  });
}

/** The pin golden's composition with all three overlays: a long headline in a pill (wraps onto two
 *  lines, then shrinks to the safe area), a round $29 badge and a logo watermark. */
function overlayDoc(logoId: string): Composition {
  const d: Composition = JSON.parse(JSON.stringify(GOLDEN_CASES.find((c) => c.preset === 'pin')!.doc));
  const overlays: Overlays = {
    headline: {
      enabled: true, text: 'A calm Shopify theme for small brands', font: 'bricolage', weight: 800, italic: false, size: 96,
      color: '#16161A', place: 'top', align: 'center', dx: 0, dy: -20, fill: 'pill', fillColor: '#FFFFFF', fillOpacity: 0.92,
    },
    badge: {
      enabled: true, text: '$29', font: 'instrument-sans', weight: 700, shape: 'circle', corner: 'br', size: 44, inset: 24,
      color: '#FFFFFF', fillColor: '#E8553D',
    },
    watermark: {
      enabled: true, kind: 'logo', imageId: logoId, imageName: 'logo.png', nw: 480, nh: 160, text: '', font: 'instrument-sans', weight: 600,
      color: '#16161A', place: 'bl', size: 100, textSize: 30, inset: 24, opacity: 0.85,
    },
  };
  return { ...d, overlays };
}

/** Overlay faces the page has loaded, as "family weight style". */
async function loadedOverlayFonts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.fonts)
      .map((f) => ({ family: f.family.replace(/^"|"$/g, ''), weight: f.weight, style: f.style, status: f.status }))
      .filter((f) => f.family.startsWith('Overlay ') && f.status === 'loaded')
      .map((f) => `${f.family} ${f.weight} ${f.style}`)
      .sort(),
  );
}

test.describe('overlays', () => {
  test('a pin with a headline, badge and watermark matches its golden', async ({ page }) => {
    await openEditor(page);
    const doc = overlayDoc(await uploadLogo(page));
    const b64 = await page.evaluate(async (doc) => {
      const LS = window.__layoutStage!;
      LS.store.getState().loadComposition(doc);
      const r = await LS.exportComposition(LS.store.getState().doc, 'png', 1);
      const url = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(r.blob);
      });
      return url.slice(url.indexOf(',') + 1);
    }, doc);
    expect(await loadedOverlayFonts(page)).toEqual(expect.arrayContaining(['Overlay Bricolage 800 normal', 'Overlay Instrument Sans 700 normal']));
    const png = Buffer.from(b64, 'base64');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1000, 1500]);
    expect(png).toMatchSnapshot('pin-overlays.png');
  });

  test('the preview draws the same overlays as the export at the same scale, and clicks pass through', async ({ page }) => {
    await openEditor(page);
    const doc = overlayDoc(await uploadLogo(page));
    await page.evaluate((doc) => window.__layoutStage!.store.getState().loadComposition(doc), doc);
    await page.waitForFunction(() => {
      const c = document.getElementById('ovCanvas') as HTMLCanvasElement | null;
      return !!c && !c.hidden && c.width > 1;
    });
    await page.waitForTimeout(300); // the logo and the fonts arrive, the canvas repaints
    const r = await page.evaluate(async () => {
      const LS = window.__layoutStage!;
      const doc = LS.store.getState().doc;
      const ov = document.getElementById('ovCanvas') as HTMLCanvasElement;
      const k = ov.width / doc.W;
      // Export without overlays, with the preview's overlay layer on top, vs the export with overlays.
      const off: Composition = JSON.parse(JSON.stringify(doc));
      off.overlays!.headline.enabled = off.overlays!.badge.enabled = off.overlays!.watermark.enabled = false;
      const base = await LS.renderComposition(off, k);
      base.getContext('2d')!.drawImage(ov, 0, 0);
      const full = await LS.renderComposition(doc, k);
      const a = base.getContext('2d')!.getImageData(0, 0, base.width, base.height).data;
      const b = full.getContext('2d')!.getImageData(0, 0, full.width, full.height).data;
      let max = 0, painted = 0;
      for (let i = 0; i < a.length; i += 4) {
        max = Math.max(max, Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) painted++;
      }
      // The overlay painted something, and the click target under the headline is still a layout.
      const ovPx = ov.getContext('2d')!.getImageData(0, 0, ov.width, ov.height).data;
      let covered = 0;
      for (let i = 3; i < ovPx.length; i += 4) if (ovPx[i] > 0) covered++;
      const s = doc.slots[0], wrap = document.getElementById('stageWrap')!.getBoundingClientRect();
      const hit = document.elementFromPoint(wrap.left + s.cx * LS.store.getState().scale, wrap.top + (s.cy - 80) * LS.store.getState().scale);
      return { sameSize: base.width === full.width && base.height === full.height && ov.height === full.height, max, painted, covered, hit: hit?.closest('.shot')?.getAttribute('data-i') ?? null };
    });
    expect(r.sameSize).toBe(true);
    expect(r.covered).toBeGreaterThan(1000);
    expect(r.max).toBeLessThanOrEqual(2); // compositing rounding only
    expect(r.hit).toBe('0');
  });
});
