'use client';
import { useEffect, useRef } from 'react';
import { useEditor } from '@/lib/store';
import { CUSTOM_MAX, CUSTOM_MIN, PRESET_IDS, PRESETS, type PresetId, type UiState } from '@/lib/model';
import { exportSize } from '@/lib/render/units';
import { useExport } from './ExportSheet';
import ThemeToggle from './ThemeToggle';

export default function TopBar() {
  const preset = useEditor((s) => s.doc.preset);
  const W = useEditor((s) => s.doc.W);
  const H = useEditor((s) => s.doc.H);
  const fmt = useEditor((s) => s.ui.exportFormat);
  const mult = useEditor((s) => s.ui.exportScale);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const { undo, redo, setPreset, setUi } = useEditor.getState();
  const rendering = useExport((s) => s.rendering);
  const runExport = useExport((s) => s.run);

  // Custom W × H: uncontrolled so typing is never overwritten; applied on the native `change` event.
  const cwRef = useRef<HTMLInputElement>(null);
  const chRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    for (const [el, v] of [[cwRef.current, W], [chRef.current, H]] as const) {
      if (el && document.activeElement !== el) el.value = String(v);
    }
  }, [W, H, preset]);
  useEffect(() => {
    const cw = cwRef.current, ch = chRef.current;
    if (!cw || !ch) return;
    const apply = () => {
      useEditor.getState().setCustomSize(+cw.value, +ch.value);
      const d = useEditor.getState().doc;
      cw.value = String(d.W);
      ch.value = String(d.H);
    };
    cw.addEventListener('change', apply);
    ch.addEventListener('change', apply);
    return () => {
      cw.removeEventListener('change', apply);
      ch.removeEventListener('change', apply);
    };
  }, []);

  const dims = exportSize({ W, H }, mult);

  /** Keyboard shortcut past the left panel: focuses the selected layout (or layout 1) on the canvas. */
  const skipToCanvas = () => {
    const sel = useEditor.getState().ui.selected;
    const shots = Array.from(document.querySelectorAll<HTMLElement>('.shot:not([hidden])'));
    (shots.find((el) => Number(el.dataset.i) === sel) ?? shots[0])?.focus();
  };

  return (
    <header className="top">
      <button className="skip" type="button" onClick={skipToCanvas}>Skip to canvas</button>
      <div className="mark">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="2.8" y="5" width="14" height="10" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="9.2" y="10.5" width="14" height="10" rx="2.4" fill="var(--accent)" />
        </svg>
        <span>Layout Stage</span>
      </div>
      <label className="field">
        <span className="field-lbl">Canvas</span>
        <select id="canvasSel" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
          {PRESET_IDS.map((id) => <option key={id} value={id}>{PRESETS[id].label}</option>)}
        </select>
      </label>
      <div className="custom" id="customDims" hidden={preset !== 'custom'}>
        <input className="num" id="cw" ref={cwRef} type="number" min={CUSTOM_MIN} max={CUSTOM_MAX} step="10" defaultValue={W} aria-label="Canvas width in pixels" />
        <span>×</span>
        <input className="num" id="ch" ref={chRef} type="number" min={CUSTOM_MIN} max={CUSTOM_MAX} step="10" defaultValue={H} aria-label="Canvas height in pixels" />
      </div>
      <div className="spacer" />
      <ThemeToggle />
      <div className="tool-group">
        <button className="icon-btn" id="undoBtn" type="button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={undo}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" /></svg>
        </button>
        <button className="icon-btn" id="redoBtn" type="button" aria-label="Redo" title="Redo (Shift Ctrl/⌘ Z)" disabled={!canRedo} onClick={redo}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3" /><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" /></svg>
        </button>
      </div>
      <div className="export">
        <select id="fmtSel" aria-label="File format" value={fmt} onChange={(e) => setUi({ exportFormat: e.target.value as UiState['exportFormat'] })}>
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
        </select>
        <select id="scaleSel" aria-label="Export scale" value={String(mult)} onChange={(e) => setUi({ exportScale: +e.target.value as UiState['exportScale'] })}>
          <option value="1">1×</option>
          <option value="2">2×</option>
        </select>
        <span className="dims" id="exportDims">{`${dims.w} × ${dims.h}`}</span>
        <button className="btn primary" id="exportBtn" type="button" disabled={rendering} onClick={() => void runExport()}>
          {rendering ? 'Rendering…' : 'Export'}
        </button>
      </div>
    </header>
  );
}
