/* Palette extraction and the "Match site colors" backgrounds, on synthetic pages built in memory. */
import { describe, expect, it } from 'vitest';
import { defaultBackground, type Background } from '@/lib/model';
import {
  chromaOf, currentVariant, deltaE, extractPalette, hexToLab, hexToRgb, lchToHex, nextSiteBackground, rgbToHex, rgbToLab,
  siteBackgrounds, swatchScore, variantPatch, type Pixels,
} from '@/lib/palette';

/** A fake page: horizontal bands of flat color (fractions of the height), with a 1 px antialiased
 *  blend row between bands, plus optional small blocks (buttons) drawn on top. */
function page(bands: [string, number][], blocks: { hex: string; x: number; y: number; w: number; h: number }[] = [], W = 120, H = 300): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, rgb: number[]) => data.set([...rgb, 255], (y * W + x) * 4);
  let y = 0;
  bands.forEach(([hex, f], i) => {
    const rows = i === bands.length - 1 ? H - y : Math.round(f * H);
    const rgb = hexToRgb(hex);
    for (let r = 0; r < rows && y < H; r++, y++) for (let x = 0; x < W; x++) put(x, y, rgb);
    if (i < bands.length - 1 && y < H) {
      const next = hexToRgb(bands[i + 1][0]);
      for (let x = 0; x < W; x++) put(x, y, rgb.map((v, k) => Math.round((v + next[k]) / 2)));
      y++;
    }
  });
  for (const b of blocks) {
    const rgb = hexToRgb(b.hex);
    for (let yy = b.y; yy < b.y + b.h; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) put(xx, yy, rgb);
  }
  return { data, width: W, height: H };
}

/** Something like the Juniper sample: blush page, plum footer, rose and gold accents, a sage band. */
const LIGHT = () =>
  page(
    [['#FFF7F4', 0.55], ['#C9D8C5', 0.15], ['#FFF7F4', 0.1], ['#3B2A2F', 0.2]],
    [
      { hex: '#CF5C78', x: 10, y: 20, w: 30, h: 8 },
      { hex: '#CF5C78', x: 60, y: 60, w: 20, h: 10 },
      { hex: '#E8B562', x: 70, y: 100, w: 24, h: 12 },
      // A near-duplicate of the background, which must merge into it.
      { hex: '#FFF6F2', x: 0, y: 130, w: 120, h: 12 },
    ],
  );

/** Something like Northbeam: near-black page, slate panels, a gold accent. */
const DARK = () =>
  page(
    [['#0E141B', 0.5], ['#22344A', 0.3], ['#0E141B', 0.2]],
    [
      { hex: '#E2B05E', x: 10, y: 30, w: 30, h: 10 },
      { hex: '#E2B05E', x: 80, y: 200, w: 20, h: 10 },
      { hex: '#7FB7A8', x: 50, y: 250, w: 30, h: 8 },
    ],
  );

/** No color at all: white page, black text bands. */
const MONO = () => page([['#FFFFFF', 0.7], ['#111111', 0.1], ['#FFFFFF', 0.1], ['#111111', 0.1]]);

describe('color math', () => {
  it('round-trips hex through Lab exactly', () => {
    for (const hex of ['#FFFFFF', '#000000', '#FFF7F4', '#CF5C78', '#0E141B', '#E1572A', '#22463A', '#7F7F7F']) {
      expect(lchToHex(hexToLab(hex)[0], chromaOf(hexToLab(hex)), (Math.atan2(hexToLab(hex)[2], hexToLab(hex)[1]) * 180) / Math.PI)).toBe(hex);
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 3);
    expect(chromaOf(white)).toBeLessThan(0.01);
  });

  it('brings out-of-gamut LCh colors into sRGB by lowering chroma, keeping lightness', () => {
    const hex = lchToHex(80, 200, 30);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(hexToLab(hex)[0]).toBeCloseTo(80, 0);
  });
});

describe('extractPalette', () => {
  it('finds the background, the ink and the accents with their exact hex codes', () => {
    const p = extractPalette(LIGHT())!;
    expect(p.dark).toBe(false);
    expect(p.background.hex).toBe('#FFF7F4');
    expect(p.ink.hex).toBe('#3B2A2F');
    expect(p.accents.map((s) => s.hex).slice(0, 2)).toEqual(['#CF5C78', '#E8B562']);
    const hexes = p.colors.map((s) => s.hex);
    expect(hexes).toContain('#C9D8C5');
    // The near-duplicate merged into the background instead of becoming a color of its own.
    expect(hexes).not.toContain('#FFF6F2');
    expect(p.background.area).toBeGreaterThan(0.6);
  });

  it('ranks by area with a boost for saturated accents', () => {
    const p = extractPalette(LIGHT())!;
    expect(p.colors[0]).toBe(p.background);
    // Scores never increase down the list.
    p.colors.slice(1).forEach((s, i) => expect(s.score).toBeLessThanOrEqual(p.colors[i].score));
    // A vivid accent outranks a muted color with three times its area, but not one with ten times.
    expect(swatchScore(0.02, 49)).toBeGreaterThan(swatchScore(0.06, 10));
    expect(swatchScore(0.02, 49)).toBeLessThan(swatchScore(0.2, 10));
    const vivid = page([['#FFFFFF', 0.7], ['#D9CFC9', 0.06], ['#FFFFFF', 0.24]], [{ hex: '#E1572A', x: 0, y: 250, w: 120, h: 6 }]);
    const q = extractPalette(vivid)!;
    expect(q.colors.map((s) => s.hex)).toEqual(['#FFFFFF', '#E1572A', '#D9CFC9']);
  });

  it('is deterministic', () => {
    expect(extractPalette(LIGHT())).toEqual(extractPalette(LIGHT()));
    expect(extractPalette(DARK())).toEqual(extractPalette(DARK()));
  });

  it('spots dark sites', () => {
    const p = extractPalette(DARK())!;
    expect(p.dark).toBe(true);
    expect(p.background.hex).toBe('#0E141B');
    expect(p.accents[0].hex).toBe('#E2B05E');
  });

  it('ignores transparent pixels and returns null for an empty image', () => {
    const px = LIGHT();
    for (let i = 3; i < px.data.length; i += 4) px.data[i] = 0;
    expect(extractPalette(px)).toBeNull();
    expect(extractPalette({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
  });

  it('handles a page with one color', () => {
    const p = extractPalette(page([['#FAFAFA', 1]]))!;
    expect(p.colors.map((s) => s.hex)).toEqual(['#FAFAFA']);
    expect(p.ink).toBe(p.background);
    expect(p.accents).toEqual([]);
  });
});

describe('site backgrounds', () => {
  const L = (hex: string) => hexToLab(hex)[0];

  it('light sites get a light base and pastel glows from their accents', () => {
    const b = siteBackgrounds(extractPalette(LIGHT())!);
    expect(L(b.mesh[0])).toBeGreaterThan(90);
    b.mesh.slice(1).forEach((g) => expect(L(g)).toBeGreaterThanOrEqual(74));
    // The first glow is the rose accent's hue, softened.
    expect(deltaE(hexToLab(b.mesh[1]), hexToLab('#CF5C78'))).toBeGreaterThan(15);
    const hue = (hex: string) => (Math.atan2(hexToLab(hex)[2], hexToLab(hex)[1]) * 180) / Math.PI;
    expect(Math.abs(hue(b.mesh[1]) - hue('#CF5C78'))).toBeLessThan(8);
    expect(b.solid).toBe(b.mesh[0]);
    expect(b.grad.a).toBe(b.mesh[0]);
    expect(L(b.grad.b)).toBeGreaterThan(75);
  });

  it('dark sites get a dark base and deep glows', () => {
    const b = siteBackgrounds(extractPalette(DARK())!);
    expect(L(b.mesh[0])).toBeLessThan(18);
    b.mesh.slice(1).forEach((g) => expect(L(g)).toBeLessThanOrEqual(52));
    expect(L(b.grad.b)).toBeLessThan(35);
  });

  it('three distinct glows even when the site has no color', () => {
    const b = siteBackgrounds(extractPalette(MONO())!);
    const glows = b.mesh.slice(1).map(hexToLab);
    expect(new Set(b.mesh).size).toBe(4);
    expect(deltaE(glows[0], glows[1])).toBeGreaterThan(5);
    expect(L(b.mesh[0])).toBeGreaterThan(90);
    b.mesh.forEach((h) => expect(h).toMatch(/^#[0-9A-F]{6}$/));
  });
});

describe('Match site colors cycle', () => {
  const apply = (bg: Background, patch: Partial<Background>) => ({ ...bg, ...patch });

  it('starts with a mesh, then gradient, solid and back to mesh', () => {
    const p = extractPalette(LIGHT())!;
    let bg = defaultBackground();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { variant, patch } = nextSiteBackground(bg, p);
      seen.push(variant);
      bg = apply(bg, patch);
      expect(bg.type).toBe(variant);
    }
    expect(seen).toEqual(['mesh', 'gradient', 'solid', 'mesh']);
  });

  it('a shuffled mesh still counts as the mesh; an edited one starts over', () => {
    const p = extractPalette(LIGHT())!;
    const bgs = siteBackgrounds(p);
    const mesh = apply(defaultBackground(), variantPatch(bgs, 'mesh'));
    expect(nextSiteBackground({ ...mesh, meshSeed: 999, grain: 30 }, p).variant).toBe('gradient');
    const edited = { ...mesh, mesh: [mesh.mesh[0], '#123456', mesh.mesh[2], mesh.mesh[3]] as Background['mesh'] };
    expect(currentVariant(edited, bgs)).toBeNull();
    expect(nextSiteBackground(edited, p).variant).toBe('mesh');
  });

  it('is case-insensitive about hex (the color picker reports lowercase)', () => {
    const p = extractPalette(DARK())!;
    const bgs = siteBackgrounds(p);
    const solid = apply(defaultBackground(), { type: 'solid', solid: bgs.solid.toLowerCase() });
    expect(nextSiteBackground(solid, p).variant).toBe('mesh');
    const grad = apply(defaultBackground(), { type: 'gradient', grad: { ...bgs.grad, b: bgs.grad.b.toLowerCase() } });
    expect(nextSiteBackground(grad, p).variant).toBe('solid');
  });
});
