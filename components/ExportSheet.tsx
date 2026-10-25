'use client';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { useEditor } from '@/lib/store';
import { exportComposition, type ExportResult } from '@/lib/render/export';

export const fmtBytes = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

interface ExportState {
  open: boolean;
  rendering: boolean;
  result: (ExportResult & { url: string }) | null;
  /** Renders the current canvas and opens the sheet. */
  run(): Promise<void>;
  close(): void;
}

/* Shared by the top bar's Export button and the sheet. Not undoable, so it stays out of lib/store. */
export const useExport = create<ExportState>()((set, get) => ({
  open: false,
  rendering: false,
  result: null,
  async run() {
    if (get().rendering) return;
    set({ rendering: true });
    const { doc, ui, showToast } = useEditor.getState();
    try {
      const r = await exportComposition(doc, ui.exportFormat, ui.exportScale);
      const prev = get().result;
      if (prev) URL.revokeObjectURL(prev.url);
      set({ result: { ...r, url: URL.createObjectURL(r.blob) }, open: true });
    } catch {
      showToast('Export failed. Try 1× or a smaller canvas size.');
    } finally {
      set({ rendering: false });
    }
  },
  close() {
    if (!get().open) return;
    set({ open: false });
    document.getElementById('exportBtn')?.focus();
  },
}));

export default function ExportSheet() {
  const open = useExport((s) => s.open);
  const result = useExport((s) => s.result);
  const close = useExport((s) => s.close);
  const cardRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (open) saveRef.current?.focus();
  }, [open]);

  if (!open || !result) return null;
  const ext = result.format === 'jpg' ? 'JPG' : 'PNG';

  // Keep Tab inside the dialog.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const f = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button, a[href]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const inside = cardRef.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      className="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={trapTab}
    >
      <div className="sheet-card" ref={cardRef}>
        <div className="sheet-head">
          <h2 id="sheetTitle">Export ready</h2>
          <button className="icon-btn" id="sheetClose" type="button" aria-label="Close" onClick={close}>✕</button>
        </div>
        <div className="sheet-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="sheetImg" src={result.url} alt="Preview of the exported image" />
        </div>
        <div className="sheet-meta">
          <strong id="sheetName">{result.name}</strong>
          <span className="fine" id="sheetMeta">{`${result.w} × ${result.h} px · ${ext} · ${fmtBytes(result.blob.size)}`}</span>
        </div>
        <div className="sheet-actions">
          <button className="btn" id="sheetBack" type="button" onClick={close}>Back to editing</button>
          <a className="btn primary" id="sheetSave" href={result.url} download={result.name} ref={saveRef}>Save file</a>
        </div>
      </div>
    </div>
  );
}
