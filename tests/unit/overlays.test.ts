/* Overlays: the model, the scale-free text layout and the shared drawing function. The layout is a
   pure function of the composition and a measure, so a fake measure (every character 0.5 em wide)
   makes every number below exact. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { clone, PRESETS, type Composition, type PresetId } from '@/lib/model';
import { defaultOverlays, fontCss, resolveFace, sanitizeOverlays, type Overlays } from '@/lib/overlays';
import { sanitizeComposition } from '@/lib/persist';
import { balance, fitText, layoutOverlays, LINE, overlayArea, REF_PX, splitLines, type Measure } from '@/lib/render/overlay-layout';
import { drawOverlays } from '@/lib/render/overlays';
import type { Rect } from '@/lib/render/units';

/** Every character is 0.5 em wide; records the fonts it was asked about. */
function fakeMeasure(fonts: string[] = []): Measure {
  return (text, font) => {
    fonts.push(font);
    const px = Number(/ ([\d.]+)px /.exec(font)?.[1]);
    return text.length * 0.5 * px;
  };
}
const wr = (s: string) => s.length * 0.5; // the fake measure per px of font size

/** A composition on a preset with only the given overlays switched on. */
function withOverlays(patch: { [K in keyof Overlays]?: Partial<Overlays[K]> }, preset: PresetId = 'pin', W?: number, H?: number): Composition {
  const d = defaultComposition();
  d.preset = preset;
  d.W = W ?? PRESETS[preset].w;
  d.H = H ?? PRESETS[preset].h;
  d.overlays = defaultOverlays();
  for (const k of Object.keys(patch) as (keyof Overlays)[]) Object.assign(d.overlays[k], { enabled: true }, patch[k]);
  return d;
}

const inside = (r: Rect, a: Rect, eps = 1e-6) => r.l >= a.l - eps && r.t >= a.t - eps && r.l + r.w <= a.l + a.w + eps && r.t + r.h <= a.t + a.h + eps;

describe('overlay model', () => {
  it('new compositions have all three overlays, switched off', () => {
    const o = defaultComposition().overlays!;
    expect([o.headline.enabled, o.badge.enabled, o.watermark.enabled]).toEqual([false, false, false]);
    expect(layoutOverlays(defaultComposition(), fakeMeasure())).toEqual({ headline: null, badge: null, watermark: null });
  });

  it('older saves without overlays get the defaults', () => {
    const old = clone(defaultComposition()) as Partial<Composition>;
    delete old.overlays;
    expect(sanitizeComposition(old)!.overlays).toEqual(defaultOverlays());
    expect(sanitizeOverlays(undefined)).toEqual(defaultOverlays());
  });

  it('keeps what is valid and repairs the rest', () => {
    const o = sanitizeOverlays({
      headline: { enabled: true, text: 'Hi', font: 'comic', place: 'bottom', size: 9999, color: 'red', dx: -500, fill: 'band', fillOpacity: 2 },
      badge: { corner: 'br', shape: 'star', text: 'x'.repeat(100) },
      watermark: { kind: 'logo', imageId: 'img_1', nw: 0, nh: 10, opacity: -1 },
    });
    expect(o.headline).toMatchObject({ enabled: true, text: 'Hi', font: 'bricolage', place: 'bottom', size: 220, color: '#16161A', dx: -150, fill: 'band', fillOpacity: 1 });
    expect(o.badge).toMatchObject({ corner: 'br', shape: 'pill' });
    expect(o.badge.text).toHaveLength(24);
    expect(o.watermark).toMatchObject({ imageId: null, nw: 0, nh: 0, opacity: 0 });
    const logo = sanitizeOverlays({ watermark: { kind: 'logo', imageId: 'img_1', imageName: 'logo.png', nw: 480, nh: 160 } }).watermark;
    expect(logo).toMatchObject({ imageId: 'img_1', imageName: 'logo.png', nw: 480, nh: 160 });
  });

  it('draws with the nearest bundled weight, italic only where the font has one', () => {
    expect(resolveFace('bricolage', 700)).toEqual({ font: 'bricolage', weight: 800, style: 'normal' });
    expect(resolveFace('instrument-sans', 800)).toEqual({ font: 'instrument-sans', weight: 700, style: 'normal' });
    expect(resolveFace('anton', 800, true)).toEqual({ font: 'anton', weight: 400, style: 'normal' });
    expect(resolveFace('instrument-serif', 800, true)).toEqual({ font: 'instrument-serif', weight: 400, style: 'italic' });
    expect(fontCss(resolveFace('instrument-serif', 400, true), 84.123456)).toBe('italic 400 84.123px "Overlay Instrument Serif", Georgia, "Times New Roman", serif');
  });
});

describe('text fitting', () => {
  it('normalizes typed text into one or two lines', () => {
    expect(splitLines('  Hello   there \n\n', 2)).toEqual(['Hello there']);
    expect(splitLines('One\nTwo\nThree', 2)).toEqual(['One', 'Two Three']);
    expect(splitLines('One\nTwo', 1)).toEqual(['One Two']);
    expect(splitLines('', 2)).toEqual([]);
  });

  it('balances two lines at a word boundary', () => {
    expect(balance('A calm Shopify theme for small brands', wr)).toEqual(['A calm Shopify theme', 'for small brands']);
    expect(balance('Unbreakable', wr)).toBeNull();
  });

  it('keeps the size when one line fits', () => {
    expect(fitText('Hello', wr, 100, 300, 1000, 0, 0, 2)).toEqual({ lines: ['Hello'], size: 100 });
  });

  it('wraps into two lines before shrinking', () => {
    // 'Hello there' is 5.5 em = 550 px at 100 px: too wide for 400; two lines of 2.5 em fit.
    expect(fitText('Hello there', wr, 100, 400, 1000, 0, 0, 2)).toEqual({ lines: ['Hello', 'there'], size: 100 });
    // One line allowed: shrink instead.
    expect(fitText('Hello there', wr, 100, 400, 1000, 0, 0, 1)).toEqual({ lines: ['Hello there'], size: 400 / 5.5 });
  });

  it('shrinks what still does not fit, padding included', () => {
    const f = fitText('Extraordinarily', wr, 100, 500, 1000, 0.5, 0.3, 2); // one word: 7.5 em + 1 em padding
    expect(f.lines).toEqual(['Extraordinarily']);
    expect(f.size).toBeCloseTo(500 / 8.5, 9);
    const tall = fitText('One\nTwo', wr, 100, 1000, 100, 0, 0.3, 2); // 2 lines × LINE + 0.6 em
    expect(tall.size).toBeCloseTo(100 / (2 * LINE + 0.6), 9);
  });

  it('honors a typed line break', () => {
    expect(fitText('Short\nA much longer second line', wr, 10, 1000, 1000, 0, 0, 2).lines).toEqual(['Short', 'A much longer second line']);
  });
});

describe('headline layout', () => {
  // Pin: the safe area is the central 80% (100, 150, 800 × 1200); the headline keeps 32 units inside it.
  const pinArea = { l: 132, t: 182, w: 736, h: 1136 };

  it('sits at the top, middle or bottom of the safe area, aligned left, center or right', () => {
    const at = (place: 'top' | 'middle' | 'bottom', align: 'left' | 'center' | 'right') =>
      layoutOverlays(withOverlays({ headline: { text: 'Hello', size: 80, place, align } }), fakeMeasure()).headline!;
    const tc = at('top', 'center');
    expect(tc.box).toEqual({ l: 500 - 100, t: pinArea.t, w: 200, h: 80 * LINE });
    expect(tc.lines).toEqual([{ text: 'Hello', x: 400, y: pinArea.t + (80 * LINE + 0.67 * 80) / 2, w: 200 }]);
    const br = at('bottom', 'right').box;
    expect([br.l + br.w, br.t + br.h]).toEqual([pinArea.l + pinArea.w, pinArea.t + pinArea.h]);
    const ml = at('middle', 'left').box;
    expect([ml.l, ml.t + ml.h / 2]).toEqual([pinArea.l, 750]);
  });

  it('wraps and shrinks to the safe area width; the pill adds its padding', () => {
    const h = layoutOverlays(withOverlays({ headline: { text: 'A calm Shopify theme for small brands', size: 84, fill: 'pill' } }), fakeMeasure()).headline!;
    expect(h.lines.map((l) => l.text)).toEqual(['A calm Shopify theme', 'for small brands']);
    // 'A calm Shopify theme' is 10 em, plus 2 × 0.55 em of pill padding = 11.1 em > 736 px at 84 px.
    expect(h.size).toBeCloseTo(736 / 11.1, 9);
    expect(h.box.w).toBeCloseTo(736, 9);
    expect(h.fill).toMatchObject({ rect: h.box, color: '#FFFFFF', opacity: 0.9 });
    // Centered lines inside the pill.
    expect(h.lines[1].x + h.lines[1].w / 2).toBeCloseTo(500, 9);
  });

  it('a band spans the canvas width behind the text', () => {
    const h = layoutOverlays(withOverlays({ headline: { text: 'Hello', fill: 'band' } }), fakeMeasure()).headline!;
    expect(h.fill!.rect).toEqual({ l: 0, t: h.box.t, w: 1000, h: h.box.h });
  });

  it('offsets move it but never out of the safe area', () => {
    const base = layoutOverlays(withOverlays({ headline: { text: 'Hello', size: 80, place: 'middle' } }), fakeMeasure()).headline!.box;
    const moved = layoutOverlays(withOverlays({ headline: { text: 'Hello', size: 80, place: 'middle', dx: 30, dy: -40 } }), fakeMeasure()).headline!.box;
    expect([moved.l - base.l, moved.t - base.t]).toEqual([30, -40]);
    const pushed = layoutOverlays(withOverlays({ headline: { text: 'Hello', size: 80, place: 'top', align: 'right', dx: 150, dy: -150 } }), fakeMeasure()).headline!.box;
    expect([pushed.l + pushed.w, pushed.t]).toEqual([900, 150]);
  });

  it('draws nothing for empty text', () => {
    expect(layoutOverlays(withOverlays({ headline: { text: '  \n ' } }), fakeMeasure()).headline).toBeNull();
  });

  it('re-lays out on another canvas shape: sizes in units, inside that canvas’s safe area', () => {
    const o = { headline: { text: 'A calm Shopify theme for small brands', size: 84, fill: 'pill' as const, place: 'bottom' as const } };
    for (const [preset, W, H] of [['etsy43', 3000, 2250], ['etsy11', 2000, 2000], ['p45', 1080, 1350], ['custom', 1200, 900]] as const) {
      const d = withOverlays(o, preset, W, H);
      const h = layoutOverlays(d, fakeMeasure()).headline!;
      expect(inside(h.box, overlayArea(d))).toBe(true);
      expect(h.size).toBeLessThanOrEqual((84 * Math.min(W, H)) / 1000 + 1e-9);
    }
    // Etsy 4:3: the 5:4 thumbnail crop is 2812.5 × 2250, centered.
    expect(overlayArea(withOverlays({}, 'etsy43'))).toEqual({ l: 93.75, t: 0, w: 2812.5, h: 2250 });
  });
});

describe('badge and watermark layout', () => {
  it('a badge sits in its corner of the safe area, inset by its margin', () => {
    const at = (corner: 'tl' | 'tr' | 'bl' | 'br') => layoutOverlays(withOverlays({ badge: { text: 'Template', size: 40, inset: 20, corner } }), fakeMeasure()).badge!;
    const tl = at('tl');
    // 4 em of text + 2 × 0.62 em padding; LINE + 2 × 0.32 em tall; a full pill.
    expect(tl.box).toEqual({ l: 120, t: 170, w: 40 * 5.24, h: 40 * (LINE + 0.64) });
    expect(tl.r).toBe(tl.box.h / 2);
    const br = at('br').box;
    expect([br.l + br.w, br.t + br.h]).toEqual([880, 1330]);
    expect(at('tr').lines[0].x + at('tr').lines[0].w / 2).toBeCloseTo(at('tr').box.l + at('tr').box.w / 2, 9);
  });

  it('a round badge is a circle, wrapping longer text onto two lines', () => {
    const b = layoutOverlays(withOverlays({ badge: { text: '$29', shape: 'circle', size: 40 } }), fakeMeasure()).badge!;
    expect(b.box.w).toBe(b.box.h);
    expect(b.box.w).toBe(40 * 2.6); // the smallest circle
    expect(b.r).toBe(b.box.w / 2);
    const long = layoutOverlays(withOverlays({ badge: { text: 'Shopify theme', shape: 'circle', size: 40 } }), fakeMeasure()).badge!;
    expect(long.lines.map((l) => l.text)).toEqual(['Shopify', 'theme']);
  });

  it('a logo keeps its aspect ratio at the area of a size × size square', () => {
    const d = withOverlays({ watermark: { kind: 'logo', imageId: 'img_logo', nw: 480, nh: 160, size: 110, inset: 32, place: 'br' } });
    const w = layoutOverlays(d, fakeMeasure()).watermark!;
    expect(w.kind).toBe('logo');
    if (w.kind !== 'logo') return;
    expect(w.rect.w * w.rect.h).toBeCloseTo(110 * 110, 6);
    expect(w.rect.w / w.rect.h).toBeCloseTo(3, 9);
    expect(w.rect.l + w.rect.w).toBeCloseTo(868, 9);
    expect(w.rect.t + w.rect.h).toBeCloseTo(1318, 9);
    const c = layoutOverlays(withOverlays({ watermark: { ...d.overlays!.watermark, place: 'center' } }), fakeMeasure()).watermark!;
    if (c.kind === 'logo') expect([c.rect.l + c.rect.w / 2, c.rect.t + c.rect.h / 2]).toEqual([500, 750]);
  });

  it('a logo watermark without a logo draws nothing; a text one lines up with its corner', () => {
    expect(layoutOverlays(withOverlays({ watermark: { kind: 'logo' } }), fakeMeasure()).watermark).toBeNull();
    const t = layoutOverlays(withOverlays({ watermark: { kind: 'text', text: 'studio.com', textSize: 30, place: 'tr', inset: 0 } }), fakeMeasure()).watermark!;
    expect(t.kind).toBe('text');
    if (t.kind === 'text') expect(t.lines[0].x + t.lines[0].w).toBe(900);
  });
});

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: { op: string; args: number[]; font?: string; text?: string }[] = [];
  const x = {
    font: '', fillStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px',
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() { calls.push({ op: 'fill', args: [] }); },
    moveTo(...a: number[]) { calls.push({ op: 'moveTo', args: a }); },
    lineTo(...a: number[]) { calls.push({ op: 'lineTo', args: a }); },
    arcTo(...a: number[]) { calls.push({ op: 'arcTo', args: a }); },
    arc(...a: number[]) { calls.push({ op: 'arc', args: a.slice(0, 3) }); },
    drawImage(_img: unknown, ...a: number[]) { calls.push({ op: 'drawImage', args: a }); },
    fillText(text: string, ...a: number[]) { calls.push({ op: 'fillText', args: a, font: x.font, text }); },
  };
  return { x: x as unknown as CanvasRenderingContext2D, calls };
}

describe('drawOverlays', () => {
  const doc = withOverlays({
    headline: { text: 'A calm Shopify theme for small brands', fill: 'pill', place: 'bottom', align: 'left', dy: -20 },
    badge: { text: 'Shopify theme', shape: 'circle', corner: 'tr' },
    watermark: { kind: 'logo', imageId: 'img_logo', nw: 480, nh: 160, place: 'tl' },
  });
  const logo = { width: 480, height: 160 } as HTMLCanvasElement;

  it('draws the same layout at any scale: every coordinate × k, text measured only at the reference size', () => {
    const fonts: string[] = [];
    const one = recorder(), big = recorder();
    drawOverlays(one.x, doc, 1, { logo }, fakeMeasure(fonts));
    drawOverlays(big.x, doc, 2.37, { logo }, fakeMeasure(fonts));
    expect(one.calls.map((c) => c.op)).toEqual(big.calls.map((c) => c.op));
    expect(one.calls.filter((c) => c.op === 'fillText').map((c) => c.text)).toEqual(['A calm Shopify theme', 'for small brands', 'Shopify', 'theme']);
    one.calls.forEach((c, i) => {
      const b = big.calls[i];
      c.args.forEach((v, j) => expect(b.args[j]).toBeCloseTo(v * 2.37, 6));
      if (c.font) {
        const px = (f: string) => Number(/ ([\d.]+)px /.exec(f)![1]);
        expect(px(b.font!)).toBeCloseTo(px(c.font) * 2.37, 2);
      }
    });
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((f) => f.includes(` ${REF_PX}px `))).toBe(true);
  });

  it('draws the watermark first and the badge last; nothing when every overlay is off', () => {
    const r = recorder();
    drawOverlays(r.x, doc, 1, { logo }, fakeMeasure());
    const ops = r.calls.map((c) => c.op);
    expect(ops[0]).toBe('drawImage');
    expect(ops.lastIndexOf('arc')).toBeGreaterThan(ops.indexOf('fillText'));
    const off = recorder();
    drawOverlays(off.x, defaultComposition(), 1, { logo }, fakeMeasure());
    expect(off.calls).toEqual([]);
  });
});
