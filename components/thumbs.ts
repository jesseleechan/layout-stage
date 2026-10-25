/* Panel thumbnails, drawn exactly like the prototype's bgThumb. Browser only. */
import { defaultBackground, MESHES, type Background } from '@/lib/model';
import { drawBackground, makeCanvas } from '@/lib/render/background';

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
