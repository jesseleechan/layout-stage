'use client';
import { anyOverlay } from '@/lib/overlays';
import { useEditor } from '@/lib/store';

/* The editor no longer has a Text & logo panel. A canvas saved while it did may still show a
   headline, badge or watermark; this says so and takes them off (one undo step). */
export default function LegacyOverlays() {
  const on = useEditor((s) => anyOverlay(s.doc));
  if (!on) return null;
  return (
    <section className="group" aria-label="Text and logo">
      <p className="fine">This canvas has a headline, badge or watermark from an earlier version of the editor.</p>
      <button className="btn wide" id="hideOverlaysBtn" type="button" onClick={() => useEditor.getState().hideOverlays()}>
        Remove text &amp; logo
      </button>
    </section>
  );
}
