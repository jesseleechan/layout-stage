'use client';
import { useRef, useState, type PointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditor } from '@/lib/store';
import { useImageUrl } from '@/lib/images';
import { miniMapSize, scrollForWindow, scrollWindow } from '@/lib/scroll';
import './canvas-tools.css';

/* The whole image of a cropped layout, with the visible window outlined. Click to center the window
   there, or drag it; live while moving, one undo step on release. Pointer only: the Scroll / Pan
   slider beside it is the keyboard and screen-reader control for the same value. */
export default function MiniMap({ i, axis }: { i: number; axis: 'x' | 'y' }) {
  const s = useEditor(useShallow((st) => {
    const t = st.doc.slots[i];
    return { imageId: t.imageId, nw: t.nw, nh: t.nh, crop: t.crop, w: t.w, fx: t.fx, fy: t.fy };
  }));
  const url = useImageUrl(s.imageId);
  const grab = useRef<{ id: number; off: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { start, size } = scrollWindow(s);
  const box = miniMapSize(s.nw, s.nh, axis);

  /** Pointer position along the axis as a fraction of the image. */
  const frac = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return axis === 'y' ? (e.clientY - b.top) / b.height : (e.clientX - b.left) / b.width;
  };
  const moveTo = (windowStart: number) => {
    const st = useEditor.getState();
    st.setScroll(i, scrollForWindow(st.doc.slots[i], windowStart));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (grab.current?.id !== e.pointerId) return;
    grab.current = null;
    setDragging(false);
    useEditor.getState().commit();
  };

  const win = axis === 'y' ? { top: `${start * 100}%`, height: `${size * 100}%` } : { left: `${start * 100}%`, width: `${size * 100}%` };
  return (
    <div className={`minimap-box ${axis}`}>
      <div
        className={`minimap ${axis}${dragging ? ' dragging' : ''}`} style={{ width: box.w, height: box.h }} aria-hidden="true"
        title="Click or drag to choose what shows"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = frac(e);
          const w = scrollWindow(useEditor.getState().doc.slots[i]);
          // Grabbing the window keeps the grab point; a click elsewhere centers the window there.
          const off = p >= w.start && p <= w.start + w.size ? p - w.start : w.size / 2;
          grab.current = { id: e.pointerId, off };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
          moveTo(p - off);
        }}
        onPointerMove={(e) => {
          if (grab.current?.id === e.pointerId) moveTo(frac(e) - grab.current.off);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url ?? undefined} alt="" draggable={false} />
        <div className="minimap-window" style={win} />
      </div>
      <div className="minimap-text">
        <span className="minimap-pct">{Math.max(1, Math.round(size * 100))}% visible</span>
        <p className="fine">Click or drag the map to choose what shows.</p>
      </div>
    </div>
  );
}
