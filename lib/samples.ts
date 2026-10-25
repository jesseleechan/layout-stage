/* The three sample sites, drawn on a canvas (not loaded). Ported line for line from
   reference/layout-stage.html (siteJuniper, siteNorthbeam, siteFieldnote and the helpers
   T, B, Lines, Dot); every coordinate, color and font comes from there, except that the text is
   drawn with bundled fonts so a sample looks the same on every machine. Browser only. */
import { SAMPLE_H, SAMPLE_IDS, SAMPLE_W } from './model';
import { roundRectPath as rr } from './render/units';

export type SampleId = (typeof SAMPLE_IDS)[number];
type Ctx = CanvasRenderingContext2D;

/* Bundled fonts, so a sample draws the same on every machine (the prototype's system fonts do not,
   which made the golden export tests machine dependent). Files in public/fonts, SIL OFL 1.1, with
   the license beside them. The family names are our own, so an installed or UI copy never mixes in.
   - Gelasio 1.008 (Fontsource 5.3.0 Latin subset) for Georgia: metric compatible with it, so serif
     text keeps the prototype's widths.
   - Inter 4.001 (inter-ui 4.1.1 web fonts) for Helvetica / Arial, subset because the stock Latin
     subset lacks the → the samples draw: pyftsubset Inter-<Weight>.woff2 --flavor=woff2
     --unicodes=U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,
     U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2195,U+2212,U+2215,U+FEFF,U+FFFD */
export const SAMPLE_FONTS: readonly { family: string; file: string; weight: string; style: string }[] = [
  { family: 'Sample Gelasio', file: '/fonts/gelasio/gelasio-latin-400-normal.woff2', weight: '400', style: 'normal' },
  { family: 'Sample Gelasio', file: '/fonts/gelasio/gelasio-latin-400-italic.woff2', weight: '400', style: 'italic' },
  { family: 'Sample Gelasio', file: '/fonts/gelasio/gelasio-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ...['400', '500', '600', '700', '800'].map((weight) => ({ family: 'Sample Inter', file: `/fonts/inter/inter-latin-${weight}-normal.woff2`, weight, style: 'normal' })),
];
/** How long a sample waits for its fonts before drawing with the fallbacks in the stack. */
const FONT_WAIT_MS = 10_000;

// The bundled family first; the prototype's stack follows as the fallback.
const SERIF = '"Sample Gelasio", Georgia, "Times New Roman", serif';
const SANS = '"Sample Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

let fontsReady: Promise<void> | null = null;

/** Loads the bundled sample fonts (once) into document.fonts. A face that fails to load is left
 *  out, so its text falls back to the next family in the stack. */
export function loadSampleFonts(): Promise<void> {
  fontsReady ??= Promise.race([
    Promise.all(
      SAMPLE_FONTS.map(async ({ family, file, weight, style }) => {
        try {
          const face = new FontFace(family, `url(${file}) format("woff2")`, { weight, style });
          document.fonts.add(await face.load());
        } catch {
          /* missing or blocked: the fallback fonts draw this text */
        }
      }),
    ).then(() => undefined),
    new Promise<void>((res) => setTimeout(res, FONT_WAIT_MS)),
  ]);
  return fontsReady;
}

/** Text. `weight` may include a style, e.g. 'italic 400'. `ls` is letter spacing in px. */
function T(x: Ctx, s: string, px: number, py: number, size: number, weight: string, fam: string, color: string, align: CanvasTextAlign = 'left', ls = 0): void {
  x.font = `${weight} ${size}px ${fam}`;
  x.fillStyle = color;
  x.textAlign = align;
  x.textBaseline = 'alphabetic';
  const has = 'letterSpacing' in x;
  if (has) x.letterSpacing = `${ls}px`;
  x.fillText(s, px, py);
  if (has) x.letterSpacing = '0px';
}

/** Filled rounded box. */
function B(x: Ctx, px: number, py: number, w: number, h: number, r: number, fill: string): void {
  rr(x, px, py, w, h, r);
  x.fillStyle = fill;
  x.fill();
}

/** n placeholder text lines (pills); the last of several is 60% wide. */
function Lines(x: Ctx, px: number, py: number, w: number, n: number, gap: number, h: number, color: string, align?: 'center'): void {
  for (let i = 0; i < n; i++) {
    const f = i === n - 1 && n > 1 ? 0.6 : [1, 0.93, 0.97, 0.9][i % 4];
    const lw = w * f;
    B(x, align === 'center' ? px - lw / 2 : px, py + i * gap, lw, h, h / 2, color);
  }
}

function Dot(x: Ctx, cx: number, cy: number, r: number, fill: string): void {
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = fill;
  x.fill();
}

function cnv(): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  return [c, c.getContext('2d')!];
}

function siteJuniper(): HTMLCanvasElement {
  const [c, x] = cnv();
  const bg = '#FFF7F4', ink = '#3B2A2F', acc = '#CF5C78', soft = '#F8DFD9', sage = '#8FAF8A', gold = '#E8B562', mute = '#EBD9D4';
  x.fillStyle = bg; x.fillRect(0, 0, 1440, 2560);
  T(x, 'Juniper & Co.', 80, 64, 30, '700', SERIF, ink);
  ['Shop', 'Weddings', 'Subscriptions', 'Journal'].forEach((s, i) => T(x, s, 600 + i * 132, 60, 17, '500', SANS, ink));
  B(x, 1170, 32, 190, 46, 23, ink); T(x, 'Order flowers', 1265, 61, 16, '600', SANS, bg, 'center');
  x.fillStyle = mute; x.fillRect(80, 106, 1280, 2);
  T(x, 'SPRING COLLECTION', 80, 232, 14, '700', SANS, acc, 'left', 3);
  T(x, 'Flowers for the', 74, 330, 78, '400', SERIF, ink);
  T(x, 'in-between days.', 74, 420, 78, 'italic 400', SERIF, acc);
  Lines(x, 80, 474, 500, 3, 28, 12, mute);
  B(x, 80, 590, 206, 58, 29, acc); T(x, 'Shop bouquets', 183, 626, 17, '600', SANS, '#FFFFFF', 'center');
  rr(x, 302, 590, 206, 58, 29); x.lineWidth = 2; x.strokeStyle = ink; x.stroke(); T(x, 'Book a consult', 405, 626, 17, '600', SANS, ink, 'center');
  B(x, 760, 150, 600, 560, 30, soft);
  x.lineCap = 'round'; x.strokeStyle = sage; x.lineWidth = 9;
  ([[900, 400], [1060, 350], [1220, 420], [990, 470], [1140, 470]] as const).forEach(([ex, ey]) => {
    x.beginPath(); x.moveTo(1060, 640); x.quadraticCurveTo((1060 + ex) / 2 + (ex < 1060 ? 30 : -30), (640 + ey) / 2, ex, ey); x.stroke();
  });
  ([[950, 540, -0.6], [1170, 545, 0.6], [1005, 595, -0.3], [1115, 600, 0.35]] as const).forEach(([lx, ly, rot]) => {
    x.save(); x.translate(lx, ly); x.rotate(rot); x.beginPath(); x.ellipse(0, 0, 46, 18, 0, 0, Math.PI * 2); x.fillStyle = '#A9C3A1'; x.fill(); x.restore();
  });
  Dot(x, 900, 400, 72, acc); Dot(x, 900, 400, 32, '#F4A9B9');
  Dot(x, 1060, 350, 86, gold); Dot(x, 1060, 350, 36, '#F7D9A2');
  Dot(x, 1220, 420, 66, '#E88AA0'); Dot(x, 1220, 420, 26, acc);
  Dot(x, 990, 470, 48, '#F3B9A9'); Dot(x, 1140, 470, 52, '#F0A3B3');
  B(x, 985, 590, 150, 100, 18, '#FFFFFF');
  T(x, 'AS FEATURED IN', 80, 808, 13, '700', SANS, '#A88F8A', 'left', 3);
  for (let i = 0; i < 5; i++) B(x, 320 + i * 212, 792, 150, 20, 10, '#EFDFDA');
  T(x, 'This week’s bestsellers', 80, 962, 46, '400', SERIF, ink);
  T(x, 'View all  →', 1360, 958, 17, '600', SANS, acc, 'right');
  ([['The Peony Cloud', '$68', acc, '#F4A9B9', '#F8DFD9'], ['Wild Meadow', '$54', gold, '#F7D9A2', '#FCEBD2'], ['Sunday Market', '$46', '#7FA07A', '#C6DBC1', '#E5EEE1']] as const)
    .forEach(([n, p, c1, c2, tile], i) => {
      const X = 80 + i * 440; B(x, X, 1010, 400, 400, 22, tile);
      Dot(x, X + 200, 1180, 92, c1); Dot(x, X + 200, 1180, 40, c2); Dot(x, X + 118, 1250, 54, c2); Dot(x, X + 286, 1256, 50, c1); Dot(x, X + 286, 1256, 20, c2);
      T(x, n, X, 1462, 25, '400', SERIF, ink); T(x, p, X + 400, 1462, 20, '600', SANS, ink, 'right'); Lines(x, X, 1488, 280, 1, 0, 10, mute);
    });
  x.fillStyle = '#EEF3EB'; x.fillRect(0, 1590, 1440, 380);
  T(x, '“The only florist my mother brags about.”', 720, 1772, 44, 'italic 400', SERIF, ink, 'center');
  T(x, 'WEDDING CLIENT, JUNE', 720, 1834, 13, '700', SANS, '#6F8569', 'center', 3);
  x.fillStyle = ink; x.fillRect(0, 2050, 1440, 510);
  T(x, 'Juniper & Co.', 80, 2150, 34, '700', SERIF, bg);
  Lines(x, 80, 2190, 340, 3, 28, 11, '#5B474D');
  ['Shop', 'Visit', 'Care guide'].forEach((h, i) => { T(x, h, 700 + i * 220, 2150, 15, '700', SANS, '#E9CFD5'); Lines(x, 700 + i * 220, 2176, 130, 3, 28, 9, '#5B474D'); });
  T(x, 'Join the Sunday letter', 80, 2380, 24, '400', SERIF, bg);
  B(x, 80, 2410, 420, 56, 28, '#4C383E'); B(x, 512, 2410, 140, 56, 28, acc); T(x, 'Sign up', 582, 2445, 16, '600', SANS, '#FFFFFF', 'center');
  return c;
}

function siteNorthbeam(): HTMLCanvasElement {
  const [c, x] = cnv();
  const bg = '#0E141B', ink = '#EAF0F4', dim = '#7F92A3', line = '#22303D', gold = '#E2B05E', panel = '#141D27';
  x.fillStyle = bg; x.fillRect(0, 0, 1440, 2560);
  T(x, 'NORTHBEAM', 80, 62, 22, '700', SANS, ink, 'left', 6);
  ['Work', 'Studio', 'Process', 'Journal'].forEach((s, i) => T(x, s, 700 + i * 112, 60, 16, '500', SANS, dim));
  rr(x, 1180, 32, 180, 44, 22); x.lineWidth = 1.5; x.strokeStyle = ink; x.stroke(); T(x, 'Start a project', 1270, 60, 15, '600', SANS, ink, 'center');
  T(x, 'ARCHITECTURE & INTERIORS', 80, 214, 14, '700', SANS, gold, 'left', 3);
  T(x, 'Quiet buildings', 74, 316, 92, '700', SANS, ink);
  T(x, 'for loud cities.', 74, 416, 92, '700', SANS, dim);
  Lines(x, 920, 252, 440, 3, 28, 11, line);
  B(x, 920, 350, 170, 52, 6, gold); T(x, 'See our work', 1005, 383, 16, '700', SANS, bg, 'center');
  T(x, '14 projects · 6 cities', 1110, 383, 14, '500', SANS, dim);
  x.save(); rr(x, 80, 480, 1280, 600, 10); x.clip();
  const g = x.createLinearGradient(0, 480, 0, 1080); g.addColorStop(0, '#22344A'); g.addColorStop(1, '#0F1822'); x.fillStyle = g; x.fillRect(80, 480, 1280, 600);
  Dot(x, 1060, 640, 70, '#C99A50');
  ([[140, 760, 150, '#243444'], [310, 680, 190, '#2C4053'], [520, 820, 130, '#1F2E3C'], [670, 600, 220, '#33495E'], [910, 740, 170, '#28394A'], [1100, 700, 200, '#2E4356']] as const)
    .forEach(([tx, ty, tw, col]) => {
      x.fillStyle = col; x.fillRect(tx, ty, tw, 1080 - ty);
      for (let wy = ty + 24; wy < 1060; wy += 34) for (let wx = tx + 18; wx < tx + tw - 26; wx += 28) {
        x.fillStyle = ((wx * 7 + wy * 13) % 11) < 3 ? 'rgba(226,176,94,.85)' : 'rgba(255,255,255,.06)'; x.fillRect(wx, wy, 12, 18);
      }
    });
  x.restore();
  T(x, 'Selected work', 80, 1210, 40, '700', SANS, ink);
  T(x, 'All projects  →', 1360, 1206, 16, '600', SANS, gold, 'right');
  ([['Harbor Library', '2025 · Civic', '#2B3E50', '#E2B05E'], ['Aster House', '2024 · Residential', '#3A2F2A', '#D98C5F'], ['Kettle Yards', '2023 · Mixed use', '#22363A', '#7FB7A8'], ['North Pier Hall', '2022 · Cultural', '#2E2B3F', '#A99BE0']] as const)
    .forEach(([n, m, col, ac], i) => {
      const X = 80 + (i % 2) * 660, Y = 1250 + Math.floor(i / 2) * 520;
      x.save(); rr(x, X, Y, 620, 380, 10); x.clip(); x.fillStyle = col; x.fillRect(X, Y, 620, 380);
      x.fillStyle = ac; x.globalAlpha = 0.9; x.beginPath(); x.moveTo(X + 120 + i * 20, Y + 380); x.lineTo(X + 310, Y + 110 + i * 20); x.lineTo(X + 500 - i * 10, Y + 380); x.closePath(); x.fill();
      x.globalAlpha = 0.35; x.fillRect(X + 40, Y + 300, 540, 80); x.globalAlpha = 1; Dot(x, X + 520, Y + 90, 34, 'rgba(255,255,255,.18)'); x.restore();
      T(x, n, X, Y + 426, 22, '700', SANS, ink); T(x, m, X + 620, Y + 426, 15, '500', SANS, dim, 'right');
    });
  x.fillStyle = panel; x.fillRect(0, 2280, 1440, 280);
  T(x, 'Let’s build something quiet.', 80, 2390, 48, '700', SANS, ink);
  B(x, 80, 2430, 200, 52, 6, gold); T(x, 'Get in touch', 180, 2463, 16, '700', SANS, bg, 'center');
  Lines(x, 1000, 2350, 360, 4, 28, 10, line);
  return c;
}

function siteFieldnote(): HTMLCanvasElement {
  const [c, x] = cnv();
  const bg = '#FFF3E6', ink = '#2A1B12', acc = '#E1572A', green = '#22463A', tan = '#F6DCC0', mute = '#EBD3BC';
  x.fillStyle = bg; x.fillRect(0, 0, 1440, 2560);
  Dot(x, 96, 56, 18, acc); Dot(x, 96, 56, 7, bg); T(x, 'Fieldnote', 126, 66, 28, '800', SANS, ink);
  ['Coffee', 'Subscriptions', 'Wholesale', 'Our roastery'].forEach((s, i) => T(x, s, 560 + i * 150, 62, 16, '600', SANS, ink));
  B(x, 1220, 34, 140, 46, 23, green); T(x, 'Cart (2)', 1290, 63, 16, '700', SANS, bg, 'center');
  T(x, 'SMALL-BATCH ROASTERY · EST. 2016', 720, 220, 14, '700', SANS, acc, 'center', 3);
  T(x, 'Roasted on Tuesday.', 720, 326, 90, '800', SANS, ink, 'center');
  T(x, 'Gone by Friday.', 720, 426, 90, '800', SANS, acc, 'center');
  Lines(x, 720, 476, 560, 2, 28, 12, mute, 'center');
  B(x, 500, 560, 210, 58, 29, green); T(x, 'Shop coffee', 605, 596, 17, '700', SANS, bg, 'center');
  rr(x, 730, 560, 210, 58, 29); x.lineWidth = 2; x.strokeStyle = ink; x.stroke(); T(x, 'Subscribe & save', 835, 596, 17, '700', SANS, ink, 'center');
  ([['ETHIOPIA', 'Guji Natural', '$21', acc, 'blueberry, jasmine'], ['COLOMBIA', 'Huila Washed', '$19', green, 'red apple, caramel'], ['HOUSE', 'Field Blend', '$17', ink, 'cocoa, toasted nut']] as const)
    .forEach(([o, n, p, col, notes], i) => {
      const X = 100 + i * 420; B(x, X, 700, 400, 480, 26, tan);
      x.fillStyle = col; x.beginPath(); x.moveTo(X + 120, 800); x.lineTo(X + 280, 800); x.lineTo(X + 300, 1110); x.lineTo(X + 100, 1110); x.closePath(); x.fill();
      B(x, X + 120, 780, 160, 30, 6, col);
      B(x, X + 140, 900, 120, 110, 10, bg); T(x, o, X + 200, 945, 15, '800', SANS, col, 'center', 2); Lines(x, X + 200, 965, 80, 2, 18, 7, mute, 'center');
      T(x, n, X, 1230, 24, '700', SANS, ink); T(x, p, X + 400, 1230, 22, '700', SANS, acc, 'right'); T(x, notes, X, 1262, 15, '500', SANS, '#8A6E5B');
    });
  x.fillStyle = green; x.fillRect(0, 1340, 1440, 520);
  T(x, 'Fresh coffee,', 100, 1500, 64, '800', SANS, bg); T(x, 'every other Tuesday.', 100, 1580, 64, '800', SANS, '#F6B38F');
  Lines(x, 100, 1630, 520, 3, 28, 11, '#3A6253');
  B(x, 100, 1740, 240, 58, 29, acc); T(x, 'Start a subscription', 220, 1776, 17, '700', SANS, '#FFFFFF', 'center');
  x.lineCap = 'round'; x.lineWidth = 26; x.strokeStyle = tan; x.beginPath(); x.arc(1210, 1600, 48, -1.1, 1.1); x.stroke();
  Dot(x, 1060, 1600, 190, '#2E5A4B'); Dot(x, 1060, 1600, 150, tan); Dot(x, 1060, 1600, 118, '#6B3B22'); Dot(x, 1020, 1560, 26, 'rgba(255,255,255,.18)');
  T(x, 'From the roastery', 100, 1990, 40, '800', SANS, ink); T(x, 'Read the journal  →', 1340, 1986, 16, '700', SANS, acc, 'right');
  ([['#F6B38F', 'Why we roast light'], ['#C9D8C5', 'Meet our Huila growers'], ['#EBD3BC', 'Brewing for a crowd']] as const).forEach(([col, t], i) => {
    const X = 100 + i * 420; B(x, X, 2030, 400, 240, 18, col); T(x, t, X, 2310, 21, '700', SANS, ink); Lines(x, X, 2332, 300, 1, 0, 9, mute);
  });
  x.fillStyle = ink; x.fillRect(0, 2420, 1440, 140); T(x, 'Fieldnote Coffee Roasters', 100, 2500, 18, '700', SANS, bg); Lines(x, 1040, 2484, 300, 1, 0, 10, '#4A372B');
  return c;
}

const SITES: Record<SampleId, () => HTMLCanvasElement> = {
  'sample:juniper': siteJuniper,
  'sample:northbeam': siteNorthbeam,
  'sample:fieldnote': siteFieldnote,
};

/** Draws the sample site at full size (1440 × 2560), once its fonts have loaded. Browser only. */
export async function drawSample(id: SampleId): Promise<HTMLCanvasElement> {
  await loadSampleFonts();
  return SITES[id]();
}
