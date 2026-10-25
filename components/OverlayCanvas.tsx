'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useEditor } from '@/lib/store';
import { anyOverlay } from '@/lib/overlays';
import { drawOverlays } from '@/lib/render/overlays';
import { fontsVersion, loadOverlayFonts, overlayFontsReady, subscribeFonts } from '@/lib/render/overlay-fonts';
import { useLoadedImage } from '@/lib/images';

/* The preview's headline, badge and watermark: a transparent canvas above the layouts, drawn by the
   same drawOverlays the export calls (lib/render/overlays.ts), at the background canvas's resolution.
   It sits beside the scaled stage rather than inside it, sized in screen px, so its bitmap reaches
   the screen 1:1 instead of being resampled through the stage's scale transform (crisper text).
   Clicks pass through to the layouts. Preview and export must render identically: change both or neither. */

const MAX_PX = 4.5e6; // same resolution cap as the preview background

export default function OverlayCanvas() {
  const key = useEditor((s) => JSON.stringify(s.doc.overlays ?? null));
  const W = useEditor((s) => s.doc.W);
  const H = useEditor((s) => s.doc.H);
  const preset = useEditor((s) => s.doc.preset);
  const scale = useEditor((s) => s.scale);
  const active = useEditor((s) => s.hydrated && anyOverlay(s.doc));
  const logoId = useEditor((s) => {
    const w = s.doc.overlays?.watermark;
    return w?.enabled && w.kind === 'logo' ? w.imageId : null;
  });
  const logo = useLoadedImage(logoId);
  const fonts = useSyncExternalStore(subscribeFonts, fontsVersion, () => 0);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const doc = useEditor.getState().doc;
    // Text waits for its font (the canvas keeps its last drawing meanwhile); a font arriving bumps `fonts`.
    if (!overlayFontsReady(doc)) {
      void loadOverlayFonts(doc);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const c = ref.current;
      const x = c?.getContext('2d');
      if (!c || !x) return;
      const d = useEditor.getState().doc;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let k0 = scale * dpr;
      if (W * k0 * H * k0 > MAX_PX) k0 = Math.sqrt(MAX_PX / (W * H));
      // Drawn at the scale of the rounded bitmap, so the layer is exactly the export at that scale.
      const cw = Math.max(1, Math.round(W * k0));
      const k = cw / W;
      const ch = Math.max(1, Math.round(H * k));
      if (c.width !== cw) c.width = cw;
      if (c.height !== ch) c.height = ch;
      // Screen size from the rounded bitmap: one bitmap px per device px, not stretched by the rounding.
      c.style.width = `${(cw * scale) / k}px`;
      c.style.height = `${(ch * scale) / k}px`;
      x.clearRect(0, 0, cw, ch);
      drawOverlays(x, d, k, { logo });
    });
    return () => cancelAnimationFrame(raf);
  }, [key, W, H, preset, scale, logo, fonts, active]);

  // Free the bitmap when nothing is shown.
  useEffect(() => {
    const c = ref.current;
    if (!active && c && c.width > 1) { c.width = 1; c.height = 1; }
  }, [active]);

  return <canvas ref={ref} className="ov-canvas" id="ovCanvas" aria-hidden="true" hidden={!active} />;
}
