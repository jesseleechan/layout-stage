/* Panel thumbnails, drawn exactly like the prototype's bgThumb / styleThumb and cached by the inputs
   that affect them. Browser only. */
import { clone, defaultBackground, MESHES, type Background, type Style } from '@/lib/model';
import { drawBackground, makeCanvas } from '@/lib/render/background';
import { hexA, roundRectPath, shadowLayers } from '@/lib/render/units';
import { drawWindowBar, windowBar } from '@/lib/render/bar';

/** A background drawn at 96 × 72 (the prototype's bgThumb). */
function bgThumb(bg: Background): string {
  const [c, x] = makeCanvas(96, 72);
  drawBackground(x, bg, 1000, 750, 0.096, null);
  return c.toDataURL();
}

let meshThumbs: string[] | null = null;
/** The six mesh swatches, drawn once (seed 3, no grain). */
export function getMeshThumbs(): string[] {
  if (!meshThumbs) meshThumbs = MESHES.map((mesh) => bgThumb({ ...defaultBackground(), type: 'mesh', mesh: [...mesh], meshSeed: 3, grain: 0 }));
  return meshThumbs;
}

/** The background a style tile shows: the style's background merged over the current one, photo → solid. */
function thumbBackground(st: Style, current: Background): Background {
  const bg: Background = Object.assign(clone(current), clone(st.background));
  bg.imageId = null;
  if (bg.type === 'image') bg.type = 'solid';
  return bg;
}

/** Only the fields drawBackground reads for this type. */
function drawKey(bg: Background): unknown {
  const t = bg.type;
  return [t, t === 'gradient' ? bg.grad : t === 'mesh' ? [bg.mesh, bg.meshSeed] : bg.solid, bg.grain, bg.texture];
}

const styleCache = new Map<string, string>();

/** A style tile thumbnail (160 × 120): the background, then a mock card with the style's frame. */
export function styleThumb(st: Style, current: Background): string {
  const bg = thumbBackground(st, current);
  const key = JSON.stringify([drawKey(bg), st.frame]);
  const hit = styleCache.get(key);
  if (hit) return hit;

  const [c, x] = makeCanvas(160, 120);
  drawBackground(x, bg, 1000, 750, 0.16, null);
  const f = st.frame, uk = 0.12 * 1.5, w = 104, h = 65, X = (160 - w) / 2, Y = (120 - h) / 2 - 3, r = Math.min(f.radius * uk, 12);
  shadowLayers(f.shadow).forEach((L) => {
    x.save();
    x.shadowColor = hexA(f.shadow.color, L.a);
    x.shadowBlur = L.b * uk;
    x.shadowOffsetX = L.x * uk;
    x.shadowOffsetY = L.y * uk;
    x.fillStyle = '#FFFFFF';
    roundRectPath(x, X, Y, w, h, r);
    x.fill();
    x.restore();
  });
  // A style with a window bar draws it in place of the mock page's 9 px header band: the layout's
  // bar drawing, taller than to scale (3.7 px here) so it reads at tile size.
  const bar = windowBar({ l: X, t: Y, w, h }, f.bar, 9);
  x.save();
  roundRectPath(x, X, Y, w, h, r);
  x.clip();
  x.fillStyle = '#FFFFFF';
  x.fillRect(X, Y, w, h);
  if (bar) drawWindowBar(x, bar);
  else {
    x.fillStyle = '#E9EAEE';
    x.fillRect(X, Y, w, 9);
  }
  x.fillStyle = '#D3D6DE';
  x.fillRect(X + 9, Y + 19, 44, 6);
  x.fillRect(X + 9, Y + 30, 30, 4);
  x.fillStyle = '#DCDFE6';
  x.fillRect(X + 62, Y + 17, 34, 38);
  x.restore();
  if (f.borderW > 0) {
    const b = Math.max(1, f.borderW * uk);
    x.save();
    roundRectPath(x, X + b / 2, Y + b / 2, w - b, h - b, Math.max(0, r - b / 2));
    x.lineWidth = b;
    x.strokeStyle = f.borderC;
    x.stroke();
    x.restore();
  }
  const url = c.toDataURL();
  if (styleCache.size > 200) styleCache.clear();
  styleCache.set(key, url);
  return url;
}
