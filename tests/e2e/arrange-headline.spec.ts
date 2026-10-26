/* Starting arrangements leave room for a top or bottom headline (lib/arrange.ts). In the page the
   headline is measured with the canvas and the bundled fonts the export draws with, so this checks the
   arrangement against what's drawn: every layout starts past the headline's ink plus the gap. */
import type { Page } from '@playwright/test';
import { HEADLINE_GAP } from '../../lib/arrange';
import type { Composition, PresetId } from '../../lib/model';
import { rectOf, unit } from '../../lib/render/units';
import { expect, test } from './local';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__layoutStage?.store.getState().hydrated === true, null, { timeout: 45_000 });
}

/** Switches the headline on at `place`, waits for its font, then sets the count and re-arranges (with
 *  the Re-arrange button when `button`). Returns the doc and the rows the headline's ink covers, in
 *  canvas px: the headline exported alone, on white, with the layouts moved off the canvas. */
async function arrangeWithHeadline(page: Page, preset: PresetId, place: 'top' | 'bottom', n: 1 | 2 | 3, button = false) {
  await page.evaluate(async ({ preset, place }) => {
    const LS = window.__layoutStage!;
    const S = () => LS.store.getState();
    S().setPreset(preset);
    S().setOverlay('headline', { enabled: true, place });
    await LS.renderComposition(S().doc, 0.05); // loads the headline's face
  }, { preset, place });
  await page.evaluate((n) => window.__layoutStage!.store.getState().setCount(n), n);
  if (button) await page.locator('#arrangeBtn').click();
  else await page.evaluate(() => window.__layoutStage!.store.getState().rearrange());
  return page.evaluate(async () => {
    const LS = window.__layoutStage!;
    const doc: Composition = JSON.parse(JSON.stringify(LS.store.getState().doc));
    const probe: Composition = JSON.parse(JSON.stringify(doc));
    probe.background = { ...probe.background, type: 'solid', solid: '#FFFFFF', grain: 0 };
    probe.slots.forEach((s) => { s.cx = -1e6; });
    const m = 0.5;
    const c = await LS.renderComposition(probe, m);
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (px[(y * c.width + x) * 4] < 200) {
          if (top < 0) top = y;
          bottom = y;
          break;
        }
      }
    }
    return { doc, ink: { t: top / m, b: (bottom + 1) / m } };
  });
}

test.describe('starting arrangement with a headline', () => {
  for (const arrangement of ['classic', 'showcase', 'grid', 'spotlight'] as const) {
    for (const preset of ['pin', 'etsy43', 'etsy11'] as const) {
      test(`${arrangement}, ${preset}: layouts start below a top headline and above a bottom one`, async ({ page }) => {
        await openEditor(page);
        await page.evaluate((a) => window.__layoutStage!.store.getState().setArrangement(a), arrangement);
        for (const place of ['top', 'bottom'] as const) {
          for (const n of [1, 2, 3] as const) {
            const { doc, ink } = await arrangeWithHeadline(page, preset, place, n, n === 2);
            const gap = HEADLINE_GAP * unit(doc.W, doc.H);
            const what = `${arrangement}, ${preset}, headline ${place}, ${n} layout(s)`;
            // The cascades and the grid stay on the canvas; whole pages may run off it.
            const contained = arrangement === 'classic' || arrangement === 'grid';
            expect(ink.t, what).toBeGreaterThan(0);
            expect(doc.count).toBe(n);
            for (let i = 0; i < n; i++) {
              const r = rectOf(doc.slots[i]);
              // Whole pages may run on behind a bottom headline (give it a band) and off the canvas;
              // the cascades, the grid and spotlight's layouts in front stay on the canvas and above it.
              const kept = contained || (arrangement === 'spotlight' && i > 0);
              if (place === 'top') {
                expect(r.t, what).toBeGreaterThanOrEqual(ink.b + gap - 2);
                if (kept) expect(r.t + r.h, what).toBeLessThanOrEqual(doc.H + 1);
              } else {
                if (kept) expect(r.t + r.h, what).toBeLessThanOrEqual(ink.t - gap + 2);
                expect(r.t, what).toBeGreaterThanOrEqual(-1);
                expect(r.t, what).toBeLessThan(ink.t - gap);
              }
            }
          }
        }
      });
    }
  }
});
