/* Site palette: the main colors of a layout's image, and backgrounds made from them.

   extractPalette() is pure and deterministic: a histogram of exact colors, weighted k-means in CIELAB
   (seeded with the most common color, then farthest-weighted picks; no randomness), near-duplicates
   merged, each cluster named by its most common exact color, so a flat button reports its real hex.
   Ranked by area with a boost for saturated accents.

   siteBackgrounds() turns a palette into the three "Match site colors" variants: a mesh on a soft tint
   of the site's background with its accents as glows, a gradient, and a solid. Light sites get light
   backgrounds, dark sites dark ones. imagePixels() is the only browser part. */
import type { Background } from './model';

export type RGB = [number, number, number];
export type Lab = [number, number, number];

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array; // RGBA
  width: number;
  height: number;
}

export interface Swatch {
  hex: string; // #RRGGBB, the most common exact color in the cluster
  lab: Lab;
  /** Share of the image, 0–1. */
  area: number;
  /** CIELAB chroma (0 grey, ~30 muted, 60+ vivid). */
  chroma: number;
  /** Hue angle in degrees (meaningless when chroma is near 0). */
  hue: number;
  score: number;
}

export interface Palette {
  /** Main colors, best first (area, with a boost for saturated accents). */
  colors: Swatch[];
  /** The largest area: the page's background. */
  background: Swatch;
  /** Saturated colors other than the background, best first. May be empty. */
  accents: Swatch[];
  /** The color that reads best on the background (text). */
  ink: Swatch;
  /** The background is dark. */
  dark: boolean;
}

/* ---------------- color math (sRGB, D65) ---------------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function hexToRgb(hex: string): RGB {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const E = 216 / 24389, K = 24389 / 27;
const f = (t: number) => (t > E ? Math.cbrt(t) : (K * t + 16) / 116);
const finv = (t: number) => (t ** 3 > E ? t ** 3 : (116 * t - 16) / K);
const XN = 0.95047, ZN = 1.08883;

export function rgbToLab([r, g, b]: RGB): Lab {
  const R = LIN[clamp(Math.round(r), 0, 255)], G = LIN[clamp(Math.round(g), 0, 255)], B = LIN[clamp(Math.round(b), 0, 255)];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Lab → sRGB 0–1 per channel, unclamped (out of gamut when outside 0–1). */
function labToRgb01([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = XN * finv(fx), y = L > K * E ? fy ** 3 : L / K, z = ZN * finv(fz);
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return lin.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055)) as RGB;
}

export const labToHex = (lab: Lab): string => rgbToHex(labToRgb01(lab).map((c) => c * 255) as RGB);
export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex));
export const chromaOf = (lab: Lab) => Math.hypot(lab[1], lab[2]);
export const hueOf = (lab: Lab) => ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;
/** CIE76 color difference. */
export const deltaE = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** An sRGB hex for lightness L, chroma C and hue h (degrees), lowering C until it fits in sRGB. */
export function lchToHex(L: number, C: number, h: number): string {
  const lab = (c: number): Lab => [L, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const inGamut = (c: number) => labToRgb01(lab(c)).every((v) => v >= -0.0005 && v <= 1.0005);
  if (inGamut(C)) return labToHex(lab(C));
  let lo = 0, hi = C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(mid)) lo = mid;
    else hi = mid;
  }
  return labToHex(lab(lo));
}

/* ---------------- extraction ---------------- */

const K_CLUSTERS = 10;
const MAX_ITER = 24;
const MERGE_DE = 11; // clusters closer than this are one color
const MIN_AREA = 0.0012; // smaller clusters are antialiasing and noise
const ACCENT_CHROMA = 18;
const MAX_COLORS = 8;

/** Ranking: area, with a boost for saturated colors so a small accent can beat a large grey. */
export const swatchScore = (area: number, chroma: number) => Math.sqrt(area) * (1 + chroma / 25);

export function extractPalette(px: Pixels): Palette | null {
  // Histogram of exact colors (opaque pixels only).
  const hist = new Map<number, number>();
  let total = 0;
  const d = px.data;
  for (let i = 0; i + 3 < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    hist.set(key, (hist.get(key) ?? 0) + 1);
    total++;
  }
  if (!total) return null;
  const keys = Array.from(hist.keys());
  const n = keys.length;
  const w = new Float64Array(n), L = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
  keys.forEach((k, i) => {
    const lab = rgbToLab([(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    w[i] = hist.get(k)!;
    [L[i], A[i], B[i]] = lab;
  });
  const dist2 = (i: number, c: Lab) => (L[i] - c[0]) ** 2 + (A[i] - c[1]) ** 2 + (B[i] - c[2]) ** 2;

  // Seeds: the most common color, then repeatedly the color with the most weight far from all seeds.
  const centers: Lab[] = [];
  let first = 0;
  for (let i = 1; i < n; i++) if (w[i] > w[first]) first = i;
  centers.push([L[first], A[first], B[first]]);
  const near = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(K_CLUSTERS, n)) {
    const c = centers[centers.length - 1];
    let best = -1, bestV = 0;
    for (let i = 0; i < n; i++) {
      near[i] = Math.min(near[i], dist2(i, c));
      const v = w[i] * near[i];
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best < 0) break;
    centers.push([L[best], A[best], B[best]]);
  }

  // Weighted k-means.
  const k = centers.length;
  const assign = new Int32Array(n).fill(-1);
  for (let it = 0; it < MAX_ITER; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bj = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dd = dist2(i, centers[j]);
        if (dd < bd) { bd = dd; bj = j; }
      }
      if (assign[i] !== bj) { assign[i] = bj; changed = true; }
    }
    if (!changed) break;
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sum[assign[i]];
      s[0] += w[i]; s[1] += w[i] * L[i]; s[2] += w[i] * A[i]; s[3] += w[i] * B[i];
    }
    sum.forEach((s, j) => { if (s[0] > 0) centers[j] = [s[1] / s[0], s[2] / s[0], s[3] / s[0]]; });
  }

  // Each cluster: total weight and its most common exact color.
  const clusters = Array.from({ length: k }, () => ({ weight: 0, top: -1 }));
  for (let i = 0; i < n; i++) {
    const c = clusters[assign[i]];
    c.weight += w[i];
    if (c.top < 0 || w[i] > w[c.top]) c.top = i;
  }

  // Merge near-duplicates into the heavier one.
  type Group = { weight: number; lab: Lab; key: number };
  const groups: Group[] = [];
  clusters
    .filter((c) => c.weight > 0)
    .sort((p, q) => q.weight - p.weight || keys[p.top] - keys[q.top])
    .forEach((c) => {
      const lab: Lab = [L[c.top], A[c.top], B[c.top]];
      const into = groups.find((g) => deltaE(g.lab, lab) < MERGE_DE);
      if (into) into.weight += c.weight;
      else groups.push({ weight: c.weight, lab, key: keys[c.top] });
    });

  const swatches: Swatch[] = groups.map((g) => {
    const area = g.weight / total, chroma = chromaOf(g.lab);
    return {
      hex: rgbToHex([(g.key >> 16) & 255, (g.key >> 8) & 255, g.key & 255]),
      lab: g.lab, area, chroma, hue: hueOf(g.lab), score: swatchScore(area, chroma),
    };
  });
  const background = swatches.reduce((p, q) => (q.area > p.area ? q : p));
  const colors = swatches
    .filter((s) => s === background || s.area >= MIN_AREA)
    .sort((p, q) => q.score - p.score || q.area - p.area)
    .slice(0, MAX_COLORS);
  const accents = colors.filter((s) => s !== background && s.chroma >= ACCENT_CHROMA);
  const others = colors.filter((s) => s !== background);
  const ink = others.length
    ? others.reduce((p, q) => (Math.abs(q.lab[0] - background.lab[0]) > Math.abs(p.lab[0] - background.lab[0]) ? q : p))
    : background;
  return { colors, background, accents, ink, dark: background.lab[0] < 50 };
}

/* ---------------- backgrounds from a palette ---------------- */

export type MatchVariant = 'mesh' | 'gradient' | 'solid';
export const MATCH_VARIANTS: MatchVariant[] = ['mesh', 'gradient', 'solid'];

export interface SiteBackgrounds {
  mesh: Background['mesh'];
  grad: Background['grad'];
  solid: string;
}

const GLOW_DE = 20; // glows this far apart read as different colors

/** Soft tint of the site's background: light sites near-white, dark sites near-black, same hue. */
function baseTone(p: Palette): { L: number; C: number; h: number } {
  const bg = p.background;
  const lead = p.accents[0];
  // A near-grey background has no hue of its own: borrow a whisper of the main accent's.
  const h = bg.chroma >= 3 || !lead ? bg.hue : lead.hue;
  if (p.dark) return { L: clamp(bg.lab[0], 9, 15), C: bg.chroma >= 3 ? clamp(bg.chroma, 3, 12) : lead ? 4 : 0, h };
  return { L: clamp(bg.lab[0] - 2, 93, 96), C: bg.chroma >= 3 ? clamp(bg.chroma * 0.8 + 2, 4, 10) : lead ? 4 : 0, h };
}

/** A glow from a site color: pastel on light sites, a deep mid-tone on dark ones. */
function glowTone(p: Palette, s: { lab: Lab; chroma: number; hue: number }): { L: number; C: number; h: number } {
  if (p.dark) return { L: clamp(s.lab[0] * 0.6, 28, 42), C: clamp(s.chroma * 0.75, 14, 38), h: s.hue };
  return { L: clamp(s.lab[0] * 0.4 + 52, 78, 88), C: clamp(s.chroma * 0.6, 14, 32), h: s.hue };
}

/** The three "Match site colors" backgrounds. Pure. */
export function siteBackgrounds(p: Palette): SiteBackgrounds {
  const b = baseTone(p);
  const base = lchToHex(b.L, b.C, b.h);
  const baseLab = hexToLab(base);

  // Glows: accents first, then other colorful site colors, each toned for the background.
  const glows: string[] = [];
  const tryAdd = (hex: string) => {
    const lab = hexToLab(hex);
    if (glows.length < 3 && deltaE(lab, baseLab) > 12 && glows.every((g) => deltaE(hexToLab(g), lab) > GLOW_DE)) glows.push(hex);
  };
  const tone = (t: { L: number; C: number; h: number }) => lchToHex(t.L, t.C, t.h);
  for (const s of p.accents) tryAdd(tone(glowTone(p, s)));
  for (const s of p.colors) if (s !== p.background && s.chroma >= 8) tryAdd(tone(glowTone(p, s)));
  // Not enough color on the site: neighbours of the main hue.
  const lead = p.accents[0] ?? p.colors.find((s) => s !== p.background && s.chroma >= 8);
  const seedHue = lead ? lead.hue : b.h;
  const seed = glowTone(p, { lab: lead ? lead.lab : p.dark ? [60, 0, 0] : [70, 0, 0], chroma: lead ? Math.max(lead.chroma, 30) : 30, hue: seedHue });
  for (const dh of [0, 40, -40, 80, -80, 160]) tryAdd(tone({ ...seed, h: (seedHue + dh + 360) % 360 }));
  while (glows.length < 3) glows.push(tone({ ...seed, L: seed.L + (p.dark ? 6 : -6) * glows.length }));

  // Gradient: light sites go from the base to a pastel of the main accent. Dark sites go to their
  // own dark surface color (a panel or section, lifted a little) when they have one, else to a deep
  // take on the main accent.
  const g0 = hexToLab(glows[0]);
  const surface = p.dark ? p.colors.find((s) => s !== p.background && s.lab[0] >= 14 && s.lab[0] <= 40 && s.chroma >= 6) : undefined;
  const end = !p.dark
    ? lchToHex(clamp(g0[0], 80, 86), clamp(chromaOf(g0), 12, 30), hueOf(g0))
    : surface
      ? lchToHex(clamp(surface.lab[0] + 4, 24, 32), clamp(surface.chroma * 1.2, 10, 26), surface.hue)
      : lchToHex(clamp(b.L + 16, 24, 30), clamp(chromaOf(g0) * 0.6, 10, 22), hueOf(g0));
  return { mesh: [base, glows[0], glows[1], glows[2]], grad: { a: base, b: end, angle: 160 }, solid: base };
}

/** The background patch for one variant. */
export function variantPatch(bgs: SiteBackgrounds, v: MatchVariant): Partial<Background> {
  if (v === 'mesh') return { type: 'mesh', mesh: [...bgs.mesh] };
  if (v === 'gradient') return { type: 'gradient', grad: { ...bgs.grad } };
  return { type: 'solid', solid: bgs.solid };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Which variant `bg` currently shows, if any (glow positions and grain don't count). */
export function currentVariant(bg: Background, bgs: SiteBackgrounds): MatchVariant | null {
  if (bg.type === 'mesh' && bg.mesh.every((c, i) => same(c, bgs.mesh[i]))) return 'mesh';
  if (bg.type === 'gradient' && same(bg.grad.a, bgs.grad.a) && same(bg.grad.b, bgs.grad.b) && bg.grad.angle === bgs.grad.angle) return 'gradient';
  if (bg.type === 'solid' && same(bg.solid, bgs.solid)) return 'solid';
  return null;
}

/** What one click of "Match site colors" applies: mesh first; on a background it made, the next
 *  variant (mesh → gradient → solid → mesh). Stateless, so it survives undo and reloads. */
export function nextSiteBackground(bg: Background, p: Palette): { variant: MatchVariant; patch: Partial<Background> } {
  const bgs = siteBackgrounds(p);
  const cur = currentVariant(bg, bgs);
  const variant = cur ? MATCH_VARIANTS[(MATCH_VARIANTS.indexOf(cur) + 1) % MATCH_VARIANTS.length] : 'mesh';
  return { variant, patch: variantPatch(bgs, variant) };
}

/* ---------------- browser ---------------- */

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** The image's pixels, downsampled (nearest neighbour, so flat colors keep their exact values) to
 *  about `budget` pixels. Browser only. */
export function imagePixels(img: Drawable, budget = 40_000): Pixels {
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const s = Math.min(1, Math.sqrt(budget / Math.max(1, iw * ih)));
  const width = Math.max(1, Math.round(iw * s)), height = Math.max(1, Math.round(ih * s));
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, width, height);
  return { data: x.getImageData(0, 0, width, height).data, width, height };
}

const cache = new Map<string, Promise<Palette | null>>();

/** The palette of a stored image, computed once per image id. `load` decodes it (lib/images' loadImage). */
export function paletteOf(id: string, load: (id: string) => Promise<Drawable | null>): Promise<Palette | null> {
  let p = cache.get(id);
  if (!p) {
    p = load(id).then((img) => (img ? extractPalette(imagePixels(img)) : null));
    cache.set(id, p);
    p.then((r) => { if (!r) cache.delete(id); });
  }
  return p;
}
