'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useEditor } from '@/lib/store';
import { CUSTOM_MAX, CUSTOM_MIN, PRESET_IDS, PRESETS, type PresetId, type UiState } from '@/lib/model';
import { exportSize } from '@/lib/render/units';
import { useExport } from './ExportSheet';
import './export.css';
import ThemeToggle from './ThemeToggle';
import ProjectsControl from './ProjectsControl';

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
      <ProjectsControl />
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
        <div className="export-split">
          <button className="btn primary" id="exportBtn" type="button" disabled={rendering} onClick={() => void runExport()}>
            {rendering ? 'Rendering…' : 'Export'}
          </button>
          <ExportMenu disabled={rendering} dims={`${dims.w} × ${dims.h}`} />
        </div>
      </div>
    </header>
  );
}

/** The ▾ beside Export: Export, Export all sizes, Etsy listing set. A menu button: Enter, Space or
 *  the arrows open it; arrows, Home and End move; Esc closes it and returns focus; Tab leaves it. */
function ExportMenu({ disabled, dims }: { disabled: boolean; dims: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusAt = useRef<'first' | 'last'>('first');
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  useEffect(() => {
    if (!open) return;
    const it = items();
    (focusAt.current === 'last' ? it[it.length - 1] : it[0])?.focus();
    const away = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const show = (at: 'first' | 'last') => { focusAt.current = at; setOpen(true); };
  const choose = (run: (returnTo: string) => Promise<void>) => {
    setOpen(false);
    void run('exportMenuBtn');
  };
  // Keys stop here: the editor's shortcuts would otherwise nudge the selected layout or deselect it.
  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    show(e.key === 'ArrowUp' ? 'last' : 'first');
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const it = items();
    const i = it.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'ArrowDown') it[(i + 1) % it.length]?.focus();
    else if (e.key === 'ArrowUp') it[(i - 1 + it.length) % it.length]?.focus();
    else if (e.key === 'Home') it[0]?.focus();
    else if (e.key === 'End') it[it.length - 1]?.focus();
    else if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const ex = useExport.getState();

  return (
    <div className="export-menu-wrap" ref={wrapRef}>
      <button
        className="btn primary export-caret" id="exportMenuBtn" type="button" ref={btnRef}
        aria-label="More export options" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'exportMenu' : undefined}
        onClick={() => (open ? setOpen(false) : show('first'))} onKeyDown={onButtonKey}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
      </button>
      {open && (
        <div className="export-menu" id="exportMenu" role="menu" aria-label="Export options" ref={menuRef} onKeyDown={onMenuKey}>
          {([
            ['Export', `This canvas · ${dims}`, ex.run],
            ['Export all sizes', 'Pinterest pin, Etsy 4:3 and Etsy square', ex.runAllSizes],
            ['Etsy listing set', 'Hero, close-ups and palette at 4:3', ex.runEtsySet],
          ] as const).map(([label, hint, run], k) => (
            <button
              key={label} role="menuitem" type="button" tabIndex={-1} disabled={disabled}
              aria-label={label} aria-describedby={`exportMenuHint${k}`} onClick={() => choose(run)}
            >
              {label}<small id={`exportMenuHint${k}`}>{hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
