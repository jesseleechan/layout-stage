'use client';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useEditor } from '@/lib/store';
import { CUSTOM_MAX, CUSTOM_MIN, PRESET_IDS, PRESETS, type PresetId, type UiState } from '@/lib/model';
import { exportSize } from '@/lib/render/units';
import { useExport } from './ExportSheet';
import './export.css';
import ThemeToggle from './ThemeToggle';
import ProjectsControl from './ProjectsControl';

/** The three floating clusters above the panels and the canvas, as in Shots: the app and project on
 *  the left, history and the canvas size in the middle, export on the right. */
export default function TopBar() {
  return (
    <>
      <TopLeft />
      <TopCenter />
      <TopRight />
    </>
  );
}

/** Keyboard shortcut past the left panel: focuses the selected layout (or layout 1) on the canvas. */
function skipToCanvas() {
  const sel = useEditor.getState().ui.selected;
  const shots = Array.from(document.querySelectorAll<HTMLElement>('.shot:not([hidden])'));
  (shots.find((el) => Number(el.dataset.i) === sel) ?? shots[0])?.focus();
}

function TopLeft() {
  return (
    <header className="cluster top-left" aria-label="Layout Stage">
      <button className="skip" type="button" onClick={skipToCanvas}>Skip to canvas</button>
      <div className="mark" title="Layout Stage">
        <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true">
          <rect x="2.8" y="5" width="14" height="10" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="9.2" y="10.5" width="14" height="10" rx="2.4" fill="currentColor" />
        </svg>
        <span>Layout Stage</span>
      </div>
      <span className="sep" aria-hidden="true" />
      <ProjectsControl />
    </header>
  );
}

function TopCenter() {
  const preset = useEditor((s) => s.doc.preset);
  const W = useEditor((s) => s.doc.W);
  const H = useEditor((s) => s.doc.H);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const { undo, redo, setPreset } = useEditor.getState();

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

  return (
    <div className="cluster top-center" role="toolbar" aria-label="Canvas">
      <div className="tool-group">
        <button className="icon-btn" id="undoBtn" type="button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={undo}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" /></svg>
        </button>
        <button className="icon-btn" id="redoBtn" type="button" aria-label="Redo" title="Redo (Shift Ctrl/⌘ Z)" disabled={!canRedo} onClick={redo}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3" /><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9" /></svg>
        </button>
      </div>
      <span className="sep" aria-hidden="true" />
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
      <span className="sep" aria-hidden="true" />
      <Hints />
      <ThemeToggle />
    </div>
  );
}

const HINTS: [string, string][] = [
  ['Drag', 'Move a layout; it snaps to edges, centers and the safe area'],
  ['Alt + drag', 'Move without snapping'],
  ['Corner handle', 'Resize'],
  ['Arrow keys', 'Nudge (Shift: 10 px)'],
  ['Space-drag · Alt-scroll', 'Scroll a cropped page'],
  ['] · [', 'Bring forward · send back'],
  ['Esc', 'Deselect'],
  ['Ctrl/⌘ Z · Shift Ctrl/⌘ Z', 'Undo · redo'],
  ['Ctrl/⌘ V', 'Paste a screenshot'],
];

/** The ⌘ button: what the mouse and the keys do on the canvas. */
function Hints() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="hints-wrap" ref={wrapRef}>
      <button
        className="icon-btn" id="hintsBtn" type="button" aria-label="Mouse and keyboard" title="Mouse and keyboard"
        aria-expanded={open} aria-controls={open ? 'hints' : undefined} onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M5.5 5.5h5v5h-5zM5.5 5.5H4a1.5 1.5 0 1 1 1.5-1.5zM10.5 5.5V4A1.5 1.5 0 1 1 12 5.5zM10.5 10.5H12A1.5 1.5 0 1 1 10.5 12zM5.5 10.5V12A1.5 1.5 0 1 1 4 10.5z" />
        </svg>
      </button>
      {open && (
        <div className="hints" id="hints" role="dialog" aria-label="Mouse and keyboard">
          <h2>On the canvas</h2>
          <dl>
            {HINTS.map(([k, v]) => (
              <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function TopRight() {
  const W = useEditor((s) => s.doc.W);
  const H = useEditor((s) => s.doc.H);
  const fmt = useEditor((s) => s.ui.exportFormat);
  const mult = useEditor((s) => s.ui.exportScale);
  const { setUi } = useEditor.getState();
  const rendering = useExport((s) => s.rendering);
  const runExport = useExport((s) => s.run);
  const dims = exportSize({ W, H }, mult);

  return (
    <div className="cluster top-right export" role="group" aria-label="Export">
      <button className="btn primary" id="exportBtn" type="button" disabled={rendering} title={`Export ${dims.w} × ${dims.h}`} onClick={() => void runExport()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 12.5V3M4 6.5 8 2.5l4 4" /><path d="M2.5 13.5h11" /></svg>
        {rendering ? 'Rendering…' : 'Export'}
      </button>
      <select id="scaleSel" aria-label="Export scale" value={String(mult)} onChange={(e) => setUi({ exportScale: +e.target.value as UiState['exportScale'] })}>
        <option value="1">1×</option>
        <option value="2">2×</option>
      </select>
      <select id="fmtSel" aria-label="File format" value={fmt} onChange={(e) => setUi({ exportFormat: e.target.value as UiState['exportFormat'] })}>
        <option value="png">PNG</option>
        <option value="jpg">JPG</option>
      </select>
      <ExportMenu disabled={rendering} dims={`${dims.w} × ${dims.h}`} />
    </div>
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
        className="icon-btn export-caret" id="exportMenuBtn" type="button" ref={btnRef}
        aria-label="More export options" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'exportMenu' : undefined}
        onClick={() => (open ? setOpen(false) : show('first'))} onKeyDown={onButtonKey}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
      </button>
      {open && (
        <div className="export-menu" id="exportMenu" role="menu" aria-label="Export options" ref={menuRef} onKeyDown={onMenuKey}>
          {([
            ['Export', `This canvas · ${dims}`, ex.run],
            ['Export all sizes', 'Pinterest pin, Etsy 4:3 and Etsy square', ex.runAllSizes],
            ['Variations', 'Six takes on this canvas, for fresh pins', ex.runVariations],
            ['Etsy listing set', 'Hero, all pages, close-ups and palette at 4:3', ex.runEtsySet],
            ['All pages image', 'Every page in Media in one grid', ex.runPagesGrid],
            ['Scrolling video…', 'MP4 of a page scrolling in its frame', ex.openVideo],
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
