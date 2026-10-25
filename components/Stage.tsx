'use client';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import { captureJobSlot, useEditor } from '@/lib/store';
import { PRESETS, type Composition } from '@/lib/model';
import { clampRadius, rectOf, safeArea, scrollAxis, shadowCSS, unit } from '@/lib/render/units';
import { drawBackground } from '@/lib/render/background';
import { useImageUrl, useLoadedImage } from '@/lib/images';
import { snap, snapThreshold } from '@/lib/snap';
import { scrollAfterMove, scrollValue } from '@/lib/scroll';
import { useExport } from './ExportSheet';
import OverlayCanvas from './OverlayCanvas';
import './canvas-tools.css';

/* The live canvas. Preview and export must render identically: the shots below are the CSS twin of
   lib/render/shot.ts (radius, box-shadow, inset border, object-position cover crop); the background is
   drawn by lib/render/background.ts for both. Change both or neither. */

const BG_MAX_PX = 4.5e6; // preview background resolution cap

type Drag =
  | { mode: 'move'; i: number; id: number; sx: number; sy: number; cx0: number; cy0: number; moved: boolean }
  | { mode: 'resize'; i: number; id: number; l: number; t: number; ar: number; moved: boolean }
  | { mode: 'scroll'; i: number; id: number; sx: number; sy: number; f0: number; axis: 'x' | 'y'; moved: boolean };

/** Alt+wheel over the selected layout scrolls its crop; one undo step after this much idle. */
const WHEEL_IDLE_MS = 350;

/** Fields where Space types: holding Space there never starts scroll mode. */
function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t instanceof HTMLInputElement && !['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(t.type);
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

/** Drops keyboard focus from a layout (clicking empty canvas deselects it). */
function blurShot() {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a.classList.contains('shot')) a.blur();
}

/* Set while a pointerdown focuses a layout, so that focus shows no keyboard ring (Chrome would
   otherwise inherit :focus-visible from a previously keyboard-focused layout). */
let pointerFocus = false;

interface ShotProps {
  i: number;
  doc: Composition;
  shadow: string;
  visible: boolean;
  onFocusRing(i: number | null): void;
}

function Shot({ i, doc, shadow, visible, onFocusRing }: ShotProps) {
  const s = doc.slots[i];
  const f = doc.frame;
  const url = useImageUrl(s.imageId);
  const r = rectOf(s);
  const u = unit(doc.W, doc.H);
  const style = {
    transform: `translate(${r.l}px, ${r.t}px)`,
    width: r.w,
    height: r.h,
    zIndex: 1 + doc.order.indexOf(i),
    borderRadius: clampRadius(f.radius * u, r.w, r.h),
    boxShadow: shadow,
    '--bw': `${f.borderW * u}px`,
    '--bc': f.borderC,
  } as CSSProperties;
  return (
    <div
      className={(f.borderW > 0 ? 'shot has-border' : 'shot') + (scrollAxis(s) ? ' scrollable' : '')} data-i={i} hidden={!visible} style={style}
      tabIndex={0} role="button" aria-label={`Layout ${i + 1}`}
      onFocus={(e) => {
        useEditor.getState().select(i);
        onFocusRing(!pointerFocus && e.currentTarget.matches(':focus-visible') ? i : null);
      }}
      onBlur={() => onFocusRing(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) useEditor.getState().select(i); }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url ?? undefined} alt="" draggable={false} style={{ objectPosition: `${s.fx}% ${s.fy}%` }} />
    </div>
  );
}

export default function Stage() {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => s.ui.selected);
  const showSafe = useEditor((s) => s.ui.showSafeArea);
  const scale = useEditor((s) => s.scale);
  const guides = useEditor((s) => s.guides);
  const toast = useEditor((s) => s.toast);
  const hydrated = useEditor((s) => s.hydrated);
  const jobs = useEditor((s) => s.captureJobs);
  const { setUi, centerGroup, rearrange } = useEditor.getState();

  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const dragDepth = useRef(0);
  const [dropping, setDropping] = useState(false);
  const [toastOn, setToastOn] = useState(false);
  const [focusRing, setFocusRing] = useState<number | null>(null);
  const [painted, setPainted] = useState(false); // first background paint after hydration
  // Scroll on the canvas: Space held (grab cursor), a Space-drag in progress (grabbing).
  const spaceRef = useRef(false);
  const overRef = useRef(false); // pointer over the board's viewport
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);

  const { W, H } = doc;

  /* ---------- fit the canvas to the viewport ---------- */
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const fit = () => {
      const vw = vp.clientWidth, vh = vp.clientHeight;
      if (!vw || !vh) return;
      const pad = Math.max(22, Math.min(48, Math.min(vw, vh) * 0.07));
      useEditor.getState().setScale(Math.max(0.02, Math.min((vw - pad * 2) / W, (vh - pad * 2) / H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [W, H]);

  /* ---------- background canvas (repainted in a rAF when it changes) ---------- */
  const bg = doc.background;
  const bgKey = JSON.stringify(bg);
  const bgImage = useLoadedImage(bg.type === 'image' ? bg.imageId : null);
  useEffect(() => {
    if (!hydrated) return;
    const raf = requestAnimationFrame(() => {
      const c = bgRef.current;
      const x = c?.getContext('2d');
      if (!c || !x) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let k = scale * dpr;
      if (W * k * H * k > BG_MAX_PX) k = Math.sqrt(BG_MAX_PX / (W * H));
      const cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k));
      if (c.width !== cw) c.width = cw;
      if (c.height !== ch) c.height = ch;
      x.clearRect(0, 0, cw, ch);
      drawBackground(x, useEditor.getState().doc.background, W, H, k, bgImage);
      setPainted(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [bgKey, W, H, scale, bgImage, hydrated]);

  /* ---------- drag to move, corner handle to resize ---------- */
  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const st = useEditor.getState();
      const k = st.scale;
      if (d.mode === 'move') {
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
        d.moved = true;
        const safe = st.ui.showSafeArea ? safeArea(PRESETS[st.doc.preset].safe, st.doc.W, st.doc.H) : null;
        const sn = snap(st.doc, d.i, d.cx0 + (e.clientX - d.sx) / k, d.cy0 + (e.clientY - d.sy) / k, snapThreshold(k), !e.altKey, safe);
        st.edit((doc) => {
          doc.slots[d.i].cx = Math.round(sn.cx * 10) / 10;
          doc.slots[d.i].cy = Math.round(sn.cy * 10) / 10;
        });
        st.setGuides(sn.gx, sn.gy);
      } else if (d.mode === 'scroll') {
        // The page follows the pointer: dragging up reveals lower content.
        const dpx = (d.axis === 'y' ? e.clientY - d.sy : e.clientX - d.sx) / k;
        st.setScroll(d.i, scrollAfterMove(st.doc.slots[d.i], d.f0, dpx));
        d.moved = true;
      } else {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const rect = wrap.getBoundingClientRect();
        const px = (e.clientX - rect.left) / k, py = (e.clientY - rect.top) / k;
        const w = Math.round(Math.max(Math.min(st.doc.W, st.doc.H) * 0.08, px - d.l, (py - d.t) * d.ar));
        st.edit((doc) => {
          const s = doc.slots[d.i];
          s.w = w;
          s.cx = d.l + w / 2;
          s.cy = d.t + w / d.ar / 2;
        });
        d.moved = true;
      }
    };
    const end = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      const st = useEditor.getState();
      st.setGuides(null, null);
      if (d.mode === 'scroll') setPanning(false);
      if (d.moved) st.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  /* ---------- scroll on the canvas: Space-drag and Alt+wheel ---------- */
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ';
    const blocked = () => useExport.getState().open || useEditor.getState().captureDialog.open;
    const down = (e: KeyboardEvent) => {
      if (!isSpace(e) || e.metaKey || e.ctrlKey || isTextEntry(e.target) || blocked()) return;
      // Over the canvas, Space is ours: no page scroll, no press on a focused button.
      if (overRef.current || drag.current?.mode === 'scroll') e.preventDefault();
      if (!spaceRef.current) { spaceRef.current = true; setSpace(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (!isSpace(e) || !spaceRef.current) return;
      if (overRef.current) e.preventDefault();
      spaceRef.current = false;
      setSpace(false);
    };
    const reset = () => { spaceRef.current = false; setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  /* Alt+wheel (Option on a Mac) over the selected layout scrolls its crop. Plain wheel is left to the
     page (the editor scrolls on phones), ⌘/Ctrl+wheel and trackpad pinch are browser zoom, and
     Shift+wheel is horizontal scrolling; Alt+wheel has no default we need. The page moves by the
     wheel's pixels like a web page (wheel down reveals lower content); one undo step after idle. */
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const st = useEditor.getState();
      const i = st.ui.selected;
      const wrap = wrapRef.current;
      if (!st.hydrated || i == null || i >= st.doc.count || !wrap) return;
      const s = st.doc.slots[i];
      const f = scrollValue(s);
      if (f == null) return;
      const k = st.scale, b = wrap.getBoundingClientRect(), r = rectOf(s);
      const x = (e.clientX - b.left) / k, y = (e.clientY - b.top) / k;
      if (x < r.l || x > r.l + r.w || y < r.t || y > r.t + r.h) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.clientHeight : 1;
      const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * px;
      const v = scrollAfterMove(s, f, -delta / k);
      if (v !== f) st.setScroll(i, v);
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => useEditor.getState().commit(), WHEEL_IDLE_MS);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      vp.removeEventListener('wheel', onWheel);
      clearTimeout(wheelTimer.current);
    };
  }, []);

  const onStageDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const st = useEditor.getState();
    const shot = (e.target as HTMLElement).closest<HTMLElement>('.shot');
    if (!shot) {
      st.select(null);
      blurShot();
      return;
    }
    const i = Number(shot.dataset.i);
    st.select(i);
    const s = st.doc.slots[i];
    if (spaceRef.current) {
      const axis = scrollAxis(s);
      if (axis) {
        drag.current = { mode: 'scroll', i, id: e.pointerId, sx: e.clientX, sy: e.clientY, f0: axis === 'y' ? s.fy : s.fx, axis, moved: false };
        setPanning(true);
      } else st.showToast('This crop shows the whole image.');
    } else drag.current = { mode: 'move', i, id: e.pointerId, sx: e.clientX, sy: e.clientY, cx0: s.cx, cy0: s.cy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Focus it so arrows and [ ] act on it right away.
    pointerFocus = true;
    shot.focus({ preventScroll: true });
    pointerFocus = false;
    setFocusRing(null);
  };

  const onHandleDown = (e: PointerEvent<HTMLSpanElement>) => {
    const st = useEditor.getState();
    const i = st.ui.selected;
    if (i == null) return;
    const r = rectOf(st.doc.slots[i]);
    drag.current = { mode: 'resize', i, id: e.pointerId, l: r.l, t: r.t, ar: r.w / r.h, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };

  /* ---------- drop files on the board ---------- */
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDropping(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropping(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    const files = Array.from(e.dataTransfer.files);
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const shot = hit?.closest<HTMLElement>('.shot');
    void useEditor.getState().placeFiles(files, files.length === 1 && shot ? Number(shot.dataset.i) : null);
  };

  /* ---------- toast ---------- */
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId == null) return;
    setToastOn(true);
    const t = setTimeout(() => setToastOn(false), 2600);
    return () => clearTimeout(t);
  }, [toastId]);

  /* ---------- overlay geometry (screen px) ---------- */
  const px = (r: { l: number; t: number; w: number; h: number }): CSSProperties => ({
    left: r.l * scale, top: r.t * scale, width: r.w * scale, height: r.h * scale,
  });
  const u = unit(W, H);
  const shadow = shadowCSS(doc.frame.shadow, u);
  const selRect = hydrated && sel != null && sel < doc.count ? rectOf(doc.slots[sel]) : null;
  const ringRect = hydrated && focusRing != null && focusRing < doc.count ? rectOf(doc.slots[focusRing]) : null;
  const safe = showSafe ? safeArea(PRESETS[doc.preset].safe, W, H) : null;
  const capturing = hydrated ? jobs.flatMap((j) => { const i = captureJobSlot(doc, j); return i == null ? [] : [{ id: j.id, i }]; }) : [];

  return (
    <section className="board" id="board" aria-label="Canvas" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div
        className="viewport" id="viewport" ref={viewportRef}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { useEditor.getState().select(null); blurShot(); } }}
        onPointerEnter={() => { overRef.current = true; }} onPointerLeave={() => { overRef.current = false; }}
      >
        <div className="stage-wrap" id="stageWrap" ref={wrapRef} style={{ width: W * scale, height: H * scale, visibility: painted ? undefined : 'hidden' }}>
          <div className={'stage' + (space ? ' space' : '') + (panning ? ' panning' : '')} id="stage" style={{ width: W, height: H, transform: `scale(${scale})` }} onPointerDown={onStageDown}>
            <canvas id="bgCanvas" ref={bgRef} aria-hidden="true" />
            {[0, 1, 2].map((i) => (
              <Shot key={i} i={i} doc={doc} shadow={shadow} visible={hydrated && i < doc.count} onFocusRing={setFocusRing} />
            ))}
          </div>
          <OverlayCanvas />
          <div className="overlay" id="overlay">
            <div className="safe-clip">
              <div className="safe" id="safe" hidden={!safe} style={safe ? px(safe) : undefined}>
                <span id="safeTag">{safe?.label}</span>
              </div>
            </div>
            <div className="guide gv" id="gv" hidden={guides.gx == null} style={{ left: (guides.gx ?? 0) * scale }} />
            <div className="guide gh" id="gh" hidden={guides.gy == null} style={{ top: (guides.gy ?? 0) * scale }} />
            {ringRect && <div className="focus-ring" style={px(ringRect)} />}
            <div className="sel" id="sel" hidden={!selRect} style={selRect ? px(selRect) : undefined}>
              <span className="sel-tag" id="selTag">
                {selRect && sel != null ? `Layout ${sel + 1} · ${Math.round(selRect.w)} × ${Math.round(selRect.h)}` : ''}
              </span>
              <span className="handle" id="handle" title="Drag to resize" onPointerDown={onHandleDown} />
            </div>
            {capturing.map((j) => {
              const r = rectOf(doc.slots[j.i]);
              return (
                <div key={j.id} className="capturing" style={{ left: (r.l + r.w / 2) * scale, top: (r.t + r.h / 2) * scale }}>
                  Capturing…
                </div>
              );
            })}
          </div>
        </div>
        <div className="droptint" id="dropTint" hidden={!dropping}><span>Drop 1–3 screenshots</span></div>
        <div className={toastOn ? 'toast show' : 'toast'} id="toast" role="status" aria-live="polite">{toast?.msg}</div>
      </div>
      <div className="boardbar">
        <p className="hint">Drag to move · corner handle resizes · arrow keys nudge (Shift for 10) · hold Alt to skip snapping · Space-drag or Alt-scroll scrolls a crop</p>
        <div className="bar-actions">
          <button className="btn sm" id="safeBtn" type="button" aria-pressed={showSafe} onClick={() => setUi({ showSafeArea: !showSafe })}>Safe area</button>
          <button className="btn sm" id="centerAllBtn" type="button" onClick={centerGroup}>Center group</button>
          <button className="btn sm" id="arrangeBtn" type="button" onClick={rearrange}>Re-arrange</button>
          <span className="zoom" id="zoomOut">{Math.round(scale * 100)}%</span>
        </div>
      </div>
    </section>
  );
}
