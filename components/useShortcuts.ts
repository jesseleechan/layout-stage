'use client';
import { useEffect } from 'react';
import { useEditor } from '@/lib/store';
import { useExport } from './ExportSheet';

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

/* App-wide keyboard shortcuts and ⌘V paste, same rules as the prototype:
   ⌘Z undo, ⇧⌘Z / ⌘Y redo, Esc deselect, ] / [ layer order, arrows nudge (Shift for 10).
   Ignored while typing in a field (⌘Z/Y still work on sliders and color pickers).
   While the export sheet is open only Esc works, and it closes the sheet. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const tag = t.tagName;
      const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
      const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      if (useExport.getState().open) {
        if (e.key === 'Escape') useExport.getState().close();
        return;
      }
      const st = useEditor.getState();
      if (st.captureDialog.open) return; // the dialog handles its own keys
      if (mod && (key === 'z' || key === 'y')) {
        const type = (t as HTMLInputElement).type;
        if (inField && type !== 'range' && type !== 'color') return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (inField || mod) return;
      if (e.key === 'Escape') { st.select(null); return; }
      const i = st.ui.selected;
      if (i == null || i >= st.doc.count) return;
      if (e.key === ']') { st.layer(1); return; }
      if (e.key === '[') { st.layer(-1); return; }
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      st.nudge(dx, dy);
    };

    const onPaste = (e: ClipboardEvent) => {
      if (useExport.getState().open || useEditor.getState().captureDialog.open) return;
      const items = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
      if (!items.length) return;
      e.preventDefault();
      const files = items.map((it) => it.getAsFile()).filter((f): f is File => !!f);
      const st = useEditor.getState();
      const sel = st.ui.selected;
      void st.placeFiles(files, files.length === 1 && sel != null && sel < st.doc.count ? sel : null);
    };

    // A file dropped outside the drop zones would otherwise navigate away from the editor.
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
