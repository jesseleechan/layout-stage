import { describe, expect, it } from 'vitest';
import { BAR_COLORS, BAR_DOTS, barKind, imageRect, windowBar } from '@/lib/render/bar';
import { barOf } from '@/lib/model';

const r = { l: 100, t: 110, w: 800, h: 500 };

describe('windowBar', () => {
  it('lays out the bar inside the top of the slot rect, the image below it', () => {
    const b = windowBar(r, 'light')!;
    const h = 800 * 0.036; // 28.8
    expect(b.kind).toBe('light');
    expect(b.bar).toEqual({ l: 100, t: 110, w: 800, h });
    expect(b.image.l).toBe(100);
    expect(b.image.t).toBeCloseTo(110 + h, 9);
    expect(b.image.w).toBe(800);
    expect(b.image.h).toBeCloseTo(500 - h, 9);
    expect(b.image.t + b.image.h).toBeCloseTo(r.t + r.h, 9);
  });

  it('puts the separator along the bar’s bottom edge', () => {
    const b = windowBar(r, 'light')!;
    const h = 28.8;
    expect(b.line.l).toBe(100);
    expect(b.line.w).toBe(800);
    expect(b.line.h).toBeCloseTo(h * 0.045, 9);
    expect(b.line.t + b.line.h).toBeCloseTo(110 + h, 9);
  });

  it('places three dots on the bar’s center line in close, minimize, zoom colors', () => {
    const b = windowBar(r, 'dark')!;
    const h = 28.8;
    expect(b.dots.map((d) => d.color)).toEqual(['#FF5F57', '#FEBC2E', '#28C840']);
    expect(b.dots.map((d) => d.color)).toEqual([...BAR_DOTS]);
    b.dots.forEach((d, j) => {
      expect(d.cx).toBeCloseTo(100 + h * 0.62 + j * h * 0.44, 9);
      expect(d.cy).toBeCloseTo(110 + h / 2, 9);
      expect(d.r * 2).toBeCloseTo(h * 0.27, 9);
    });
  });

  it('centers a fully rounded address field on the window', () => {
    const b = windowBar(r, 'light')!;
    const h = 28.8;
    expect(b.field.w).toBeCloseTo(800 * 0.42, 9);
    expect(b.field.h).toBeCloseTo(h * 0.5, 9);
    expect(b.field.l + b.field.w / 2).toBeCloseTo(100 + 400, 9);
    expect(b.field.t + b.field.h / 2).toBeCloseTo(110 + h / 2, 9);
  });

  it('uses the light and dark colors', () => {
    expect(windowBar(r, 'light')!.colors).toEqual({ bar: '#F3F2EF', line: '#E2E0DB', field: '#E4E2DD' });
    expect(windowBar(r, 'dark')!.colors).toEqual({ bar: '#2B2A2D', line: '#1D1C1F', field: '#3D3C40' });
    expect(windowBar(r, 'dark')!.colors).toEqual(BAR_COLORS.dark);
  });

  it('draws none for anything but light / dark; the image then fills the slot', () => {
    for (const v of ['none', undefined, null, '', 'Light', 'blue', 1, {}]) {
      expect(windowBar(r, v)).toBeNull();
      expect(barKind(v)).toBeNull();
      expect(imageRect(r, v)).toEqual(r);
      expect(barOf(v)).toBe('none');
    }
    expect(barOf('light')).toBe('light');
    expect(barOf('dark')).toBe('dark');
    expect(imageRect(r, 'dark')).toEqual(windowBar(r, 'dark')!.image);
  });

  it('scales with the rect, so canvas px × k gives the output px geometry (preview and export agree)', () => {
    const k = 2.5;
    const a = windowBar(r, 'light')!;
    const b = windowBar({ l: r.l * k, t: r.t * k, w: r.w * k, h: r.h * k }, 'light')!;
    const flat = (g: typeof a) => [
      ...Object.values(g.bar), ...Object.values(g.line), ...Object.values(g.field), ...Object.values(g.image),
      ...g.dots.flatMap((d) => [d.cx, d.cy, d.r]),
    ];
    flat(a).forEach((v, i) => expect(flat(b)[i]).toBeCloseTo(v * k, 6));
    // local px (the DOM preview) is the same geometry moved to the slot's corner
    const local = windowBar({ l: 0, t: 0, w: r.w, h: r.h }, 'light')!;
    expect(local.field.l + r.l).toBeCloseTo(a.field.l, 9);
    expect(local.image.t + r.t).toBeCloseTo(a.image.t, 9);
  });

  it('takes a bar height override (the style tile mock) and keeps the rest of the layout', () => {
    const b = windowBar({ l: 28, t: 24.5, w: 104, h: 65 }, 'light', 9)!;
    expect(b.bar.h).toBe(9);
    expect(b.image).toEqual({ l: 28, t: 33.5, w: 104, h: 56 });
    expect(b.field.w).toBeCloseTo(104 * 0.42, 9);
  });
});
