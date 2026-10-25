import { describe, expect, it } from 'vitest';
import { sampleSlot, type Shadow, type Slot } from '@/lib/model';
import {
  autoCrop, capHeight, clampRadius, coverSource, cropRatio, exportScale, exportSize, groupBounds, hexA, rectOf,
  safeArea, scrollAxis, shadowCSS, shadowLayers, unit,
} from '@/lib/render/units';
import { defaultComposition } from '@/lib/arrange';

const slot = (patch: Partial<Slot> = {}): Slot => ({ ...sampleSlot(0), ...patch });
const shadow = (patch: Partial<Shadow> = {}): Shadow => ({ preset: 'custom', blur: 80, x: 0, y: 40, opacity: 0.28, color: '#4A2533', ...patch });

describe('unit', () => {
  it('is 1/1000 of the short side', () => {
    expect(unit(1000, 1500)).toBe(1);
    expect(unit(3000, 2250)).toBe(2.25);
    expect(unit(2000, 2000)).toBe(2);
  });
});

describe('cropRatio', () => {
  it('uses the crop ratio, or the natural ratio for Full', () => {
    expect(cropRatio({ crop: 'full', nw: 1440, nh: 2560 })).toBeCloseTo(0.5625);
    expect(cropRatio({ crop: '16:10', nw: 1440, nh: 2560 })).toBe(1.6);
    expect(cropRatio({ crop: '4:3', nw: 1, nh: 1 })).toBeCloseTo(4 / 3);
    expect(cropRatio({ crop: '1:1', nw: 1, nh: 9 })).toBe(1);
    expect(cropRatio({ crop: '4:5', nw: 1, nh: 9 })).toBe(0.8);
    expect(cropRatio({ crop: '9:16', nw: 1, nh: 9 })).toBe(9 / 16);
  });
});

describe('rectOf', () => {
  it('centers a w × w/ratio rect on the slot center', () => {
    expect(rectOf(slot({ crop: '16:10', cx: 500, cy: 750, w: 800 }))).toEqual({ l: 100, t: 500, w: 800, h: 500 });
  });
  it('accepts another center', () => {
    expect(rectOf(slot({ crop: '1:1', cx: 0, cy: 0, w: 200 }), 300, 400)).toEqual({ l: 200, t: 300, w: 200, h: 200 });
  });
  it('uses the natural ratio for Full', () => {
    const r = rectOf(slot({ crop: 'full', nw: 1440, nh: 2560, cx: 720, cy: 1280, w: 1440 }));
    expect(r).toEqual({ l: 0, t: 0, w: 1440, h: 2560 });
  });
});

describe('scrollAxis', () => {
  it('is null when the crop shows the whole image', () => {
    expect(scrollAxis(slot({ crop: 'full' }))).toBeNull();
    expect(scrollAxis(slot({ crop: '9:16', nw: 1440, nh: 2560 }))).toBeNull(); // same ratio
    expect(scrollAxis(slot({ crop: '1:1', nw: 1000, nh: 1005 }))).toBeNull(); // within .01
  });
  it('scrolls (y) when the image is taller than the crop', () => {
    expect(scrollAxis(slot({ crop: '16:10', nw: 1440, nh: 2560 }))).toBe('y');
    expect(scrollAxis(slot({ crop: '4:5', nw: 1440, nh: 2560 }))).toBe('y');
  });
  it('pans (x) when the image is wider than the crop', () => {
    expect(scrollAxis(slot({ crop: '1:1', nw: 3000, nh: 1000 }))).toBe('x');
    expect(scrollAxis(slot({ crop: '9:16', nw: 1440, nh: 1440 }))).toBe('x');
  });
});

describe('autoCrop', () => {
  it('shows Full when the ratio is at least 0.9', () => {
    expect(autoCrop(1920, 1080)).toBe('full');
    expect(autoCrop(1000, 1000)).toBe('full');
    expect(autoCrop(900, 1000)).toBe('full');
    expect(autoCrop(3000, 3333)).toBe('full'); // 0.90009
  });
  it('gives a tall capture at least 1280 wide 16:10', () => {
    expect(autoCrop(1440, 9000)).toBe('16:10');
    expect(autoCrop(1280, 1500)).toBe('16:10');
    expect(autoCrop(2880, 24000)).toBe('16:10');
  });
  it('gives a narrower one Full, or 9:16 under 0.4', () => {
    expect(autoCrop(1279, 1500)).toBe('full');
    expect(autoCrop(1170, 2532)).toBe('full'); // phone first screen, ratio .46
    expect(autoCrop(400, 1000)).toBe('full'); // exactly .4
    expect(autoCrop(399, 1000)).toBe('9:16');
    expect(autoCrop(390, 6000)).toBe('9:16'); // phone full page
  });
});

describe('capHeight', () => {
  it('caps the height at 90% of the canvas', () => {
    const s = slot({ crop: '9:16', w: 1000 }); // h = 1777.8
    capHeight(s, 1500);
    expect(s.w).toBe(Math.round(1350 * (9 / 16)));
    expect(s.w / cropRatio(s)).toBeLessThanOrEqual(1350 + 1);
  });
  it('leaves a shorter image alone', () => {
    const s = slot({ crop: '16:10', w: 700 });
    capHeight(s, 1500);
    expect(s.w).toBe(700);
  });
  it('caps exactly at the limit without changing it', () => {
    const s = slot({ crop: '1:1', w: 1350 });
    capHeight(s, 1500);
    expect(s.w).toBe(1350);
  });
});

describe('clampRadius', () => {
  it('clamps to half the shorter side and to 0', () => {
    expect(clampRadius(14, 700, 437.5)).toBe(14);
    expect(clampRadius(500, 300, 200)).toBe(100);
    expect(clampRadius(500, 100, 200)).toBe(50);
    expect(clampRadius(-3, 100, 100)).toBe(0);
  });
});

describe('hexA', () => {
  it('converts #RRGGBB and alpha to rgba() with 3 decimals', () => {
    expect(hexA('#4A2533', 0.28)).toBe('rgba(74,37,51,0.280)');
    expect(hexA('FFFFFF', 1)).toBe('rgba(255,255,255,1.000)');
  });
  it('expands #RGB', () => {
    expect(hexA('#abc', 0.5)).toBe('rgba(170,187,204,0.500)');
  });
  it('clamps alpha to 0–1', () => {
    expect(hexA('#000000', 1.7)).toBe('rgba(0,0,0,1.000)');
    expect(hexA('#000000', -1)).toBe('rgba(0,0,0,0.000)');
  });
  it('falls back to black for junk', () => {
    expect(hexA('', 0.1)).toBe('rgba(0,0,0,0.100)');
    expect(hexA('#zzzzzz', 0.1)).toBe('rgba(0,0,0,0.100)');
  });
});

describe('shadowLayers', () => {
  it('adds an ambient layer at (0.2x, 0.18y + 1, 0.22 blur + 2, min(1, .55 opacity))', () => {
    const L = shadowLayers(shadow({ blur: 80, x: 10, y: 40, opacity: 0.28 }));
    expect(L).toHaveLength(2);
    expect(L[0]).toEqual({ x: 10, y: 40, b: 80, a: 0.28 });
    expect(L[1].x).toBeCloseTo(2);
    expect(L[1].y).toBeCloseTo(0.18 * 40 + 1);
    expect(L[1].b).toBeCloseTo(0.22 * 80 + 2);
    expect(L[1].a).toBeCloseTo(0.154);
  });
  it('caps the ambient opacity at 1', () => {
    expect(shadowLayers(shadow({ blur: 10, opacity: 1 }))[1].a).toBeCloseTo(0.55);
    expect(shadowLayers(shadow({ blur: 10, opacity: 2 }))[1].a).toBe(1);
  });
  it('has no layers when the opacity is 0', () => {
    expect(shadowLayers(shadow({ opacity: 0 }))).toEqual([]);
    expect(shadowLayers(shadow({ opacity: Number.NaN }))).toEqual([]);
  });
  it('has no ambient layer when blur is 0 (the Hard preset)', () => {
    expect(shadowLayers(shadow({ blur: 0, x: 14, y: 14, opacity: 1 }))).toEqual([{ x: 14, y: 14, b: 0, a: 1 }]);
  });
});

describe('shadowCSS', () => {
  it('lists the main layer first, each value × u', () => {
    expect(shadowCSS(shadow({ blur: 80, x: 0, y: 40, opacity: 0.28, color: '#4A2533' }), 1)).toBe(
      '0.00px 40.00px 80.00px rgba(74,37,51,0.280), 0.00px 8.20px 19.60px rgba(74,37,51,0.154)',
    );
    expect(shadowCSS(shadow({ blur: 80, x: 0, y: 40, opacity: 0.28, color: '#4A2533' }), 2.25)).toBe(
      '0.00px 90.00px 180.00px rgba(74,37,51,0.280), 0.00px 18.45px 44.10px rgba(74,37,51,0.154)',
    );
  });
  it('draws Hard as one unblurred layer', () => {
    expect(shadowCSS(shadow({ blur: 0, x: 14, y: 14, opacity: 1, color: '#16161A' }), 2)).toBe('28.00px 28.00px 0.00px rgba(22,22,26,1.000)');
  });
  it('is "none" without a shadow', () => {
    expect(shadowCSS(shadow({ opacity: 0 }), 1)).toBe('none');
  });
});

describe('exportScale / exportSize', () => {
  it('keeps the chosen scale under the 8000 px cap', () => {
    expect(exportSize({ W: 1000, H: 1500 }, 2)).toEqual({ w: 2000, h: 3000, m: 2 });
    expect(exportSize({ W: 3000, H: 2250 }, 1)).toEqual({ w: 3000, h: 2250, m: 1 });
    expect(exportSize({ W: 3000, H: 2250 }, 2)).toEqual({ w: 6000, h: 4500, m: 2 });
    expect(exportSize({ W: 4000, H: 3000 }, 2)).toEqual({ w: 8000, h: 6000, m: 2 }); // exactly at the cap
  });
  it('caps the long side at 8000 px', () => {
    expect(exportSize({ W: 6000, H: 4000 }, 2)).toEqual({ w: 8000, h: 5333, m: 8000 / 6000 });
    expect(exportSize({ W: 4000, H: 6000 }, 2)).toEqual({ w: 5333, h: 8000, m: 8000 / 6000 });
    expect(exportSize({ W: 6000, H: 6000 }, 2)).toEqual({ w: 8000, h: 8000, m: 8000 / 6000 });
    expect(exportScale(6000, 4000, 1)).toBe(1);
    expect(exportScale(5000, 200, 2)).toBe(1.6);
  });
});

describe('safeArea', () => {
  it('Etsy square: the 5:4 thumbnail crop removes 200 px top and bottom', () => {
    const r = safeArea('etsy', 2000, 2000);
    expect(r).toMatchObject({ l: 0, t: 200, w: 2000, h: 1600 });
    expect(r.label).toMatch(/5:4/);
  });
  it('Etsy landscape (wider than 5:4) crops the sides', () => {
    const r = safeArea('etsy', 3000, 2250);
    expect(r).toMatchObject({ t: 0, h: 2250, w: 2812.5, l: 93.75 });
  });
  it('is the central 80% otherwise', () => {
    const r = safeArea('inset', 1000, 1500);
    expect(r).toMatchObject({ l: 100, t: 150, w: 800, h: 1200 });
    expect(r.label).toMatch(/80%/);
  });
});

describe('coverSource', () => {
  /** CSS object-fit: cover + object-position fx% fy%: the image is scaled by sc and offset by
   *  (box − scaled) · p%. The source point at the box's top-left is −offset / sc. */
  function cssCover(nw: number, nh: number, w: number, h: number, fx: number, fy: number) {
    const sc = Math.max(w / nw, h / nh);
    const ox = ((w - nw * sc) * fx) / 100, oy = ((h - nh * sc) * fy) / 100;
    return { sx: -ox / sc, sy: -oy / sc, sw: w / sc, sh: h / sc };
  }

  it('matches CSS object-position percentages', () => {
    for (const [nw, nh, w, h] of [[1440, 2560, 700, 437.5], [2880, 2560, 600, 600], [800, 600, 300, 900], [1000, 1000, 400, 250]]) {
      for (const fx of [0, 13, 50, 87, 100]) for (const fy of [0, 35, 50, 100]) {
        const a = coverSource(nw, nh, w, h, fx, fy), b = cssCover(nw, nh, w, h, fx, fy);
        expect(a.sx).toBeCloseTo(b.sx, 6);
        expect(a.sy).toBeCloseTo(b.sy, 6);
        expect(a.sw).toBeCloseTo(b.sw, 6);
        expect(a.sh).toBeCloseTo(b.sh, 6);
      }
    }
  });
  const near = (a: Record<string, number>, b: Record<string, number>) => {
    for (const k of Object.keys(b)) expect(a[k], k).toBeCloseTo(b[k], 6);
  };
  it('scrolls a tall page: 0% top, 50% middle, 100% bottom', () => {
    // a 16:10 window onto a 1440 × 2560 page shows 1440 × 900 source px
    near(coverSource(1440, 2560, 800, 500, 50, 0), { sx: 0, sy: 0, sw: 1440, sh: 900 });
    near(coverSource(1440, 2560, 800, 500, 50, 50), { sx: 0, sy: 830, sw: 1440, sh: 900 });
    near(coverSource(1440, 2560, 800, 500, 50, 100), { sx: 0, sy: 1660, sw: 1440, sh: 900 });
  });
  it('pans a wide image: 0% left, 50% center, 100% right', () => {
    near(coverSource(3000, 1000, 500, 500, 0, 0), { sx: 0, sy: 0, sw: 1000, sh: 1000 });
    near(coverSource(3000, 1000, 500, 500, 50, 0), { sx: 1000, sy: 0, sw: 1000, sh: 1000 });
    near(coverSource(3000, 1000, 500, 500, 100, 0), { sx: 2000, sy: 0, sw: 1000, sh: 1000 });
  });
  it('ignores the position on the axis that fits', () => {
    expect(coverSource(1440, 2560, 800, 500, 100, 0).sx).toBe(0);
    expect(coverSource(3000, 1000, 500, 500, 0, 100).sy).toBe(0);
  });
});

describe('groupBounds', () => {
  it('bounds the visible slots only', () => {
    const d = defaultComposition();
    d.count = 2;
    d.slots[0] = { ...d.slots[0], crop: '1:1', cx: 100, cy: 100, w: 100 };
    d.slots[1] = { ...d.slots[1], crop: '1:1', cx: 400, cy: 300, w: 200 };
    d.slots[2] = { ...d.slots[2], crop: '1:1', cx: 5000, cy: 5000, w: 200 };
    expect(groupBounds(d)).toEqual({ l: 50, t: 50, w: 450, h: 350 });
  });
});
