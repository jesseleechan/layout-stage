'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { useEditor } from '@/lib/store';
import { clone, PRESETS, type Composition, type UiState } from '@/lib/model';
import { exportComposition, exportFileName, renderComposition, type ExportResult } from '@/lib/render/export';
import { makeCanvas } from '@/lib/render/background';
import { renderPaletteCard } from '@/lib/render/palette-card';
import { exportScale } from '@/lib/render/units';
import { loadImage } from '@/lib/images';
import { paletteOf, siteBackgrounds } from '@/lib/palette';
import { allSizes, ALL_SIZES_ZIP, etsySet, ETSY_SET_ZIP, pagesImages, PAGES_ZIP, setFileName, VARIATIONS_ZIP, type SetItem } from '@/lib/sets';
import { hasPages } from '@/lib/pages-grid';
import { pinVariations, variationPages } from '@/lib/variations';
import { pageMeasure } from '@/lib/arrange';
import { renderPagesGrid } from '@/lib/render/pages-grid';
import { zipBlobs } from '@/lib/zip';
import PinTextSection from './PinText';
import VideoBody from './VideoSheet';
import './export.css';

export const fmtBytes = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

type Format = UiState['exportFormat'];
type Mode = 'single' | 'sizes' | 'etsy' | 'pages' | 'variations' | 'video';
type MultiMode = Exclude<Mode, 'single' | 'video'>;

/** One file of a multi-image export. */
export interface SheetItem {
  key: string;
  label: string;
  status: 'pending' | 'done' | 'error';
  name: string;
  w: number;
  h: number;
  format: Format;
  blob: Blob | null;
  /** The file, for Save. */
  url: string | null;
  /** A small preview. */
  thumb: string | null;
  error?: string;
  /** A variation that can be put on the canvas. */
  doc?: Composition;
}

interface ExportState {
  open: boolean;
  mode: Mode;
  rendering: boolean;
  /** Single export: the file, plus what was rendered (Copy re-renders it as PNG for a JPG). */
  result: (ExportResult & { url: string; doc: Composition; m: number }) | null;
  /** Multi-image exports. */
  items: SheetItem[];
  zip: { url: string; name: string; size: number } | null;
  /** A short message shown inside the sheet (it covers the editor's toast). */
  note: { id: number; msg: string } | null;
  /** Element to focus when the sheet closes. */
  returnTo: string;
  /** Renders the current canvas and opens the sheet. */
  run(returnTo?: string): Promise<void>;
  /** Pin, Etsy 4:3 and Etsy square from the current canvas. */
  runAllSizes(returnTo?: string): Promise<void>;
  /** The Etsy listing set from the current canvas. */
  runEtsySet(returnTo?: string): Promise<void>;
  /** Every page in Media in one grid, at Etsy 4:3, pin and Etsy square (lib/pages-grid.ts). */
  runPagesGrid(returnTo?: string): Promise<void>;
  /** Pin variations of the current canvas (lib/variations.ts). */
  runVariations(returnTo?: string): Promise<void>;
  /** Opens the scrolling video sheet (components/VideoSheet.tsx). */
  openVideo(returnTo?: string): Promise<void>;
  /** Shows a short message inside the sheet. */
  notify(msg: string): void;
  copy(): void;
  close(): void;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));
const mime = (f: Format) => (f === 'jpg' ? 'image/jpeg' : 'image/png');
/** Lets the sheet paint between renders. */
const yieldFrame = () => new Promise((res) => setTimeout(res, 0));

/** A preview at most 640 px on the long side. */
async function thumbnail(c: HTMLCanvasElement): Promise<string> {
  const k = Math.min(1, 640 / Math.max(c.width, c.height));
  const [t, x] = makeCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
  x.imageSmoothingQuality = 'high';
  x.drawImage(c, 0, 0, t.width, t.height);
  const b = await toBlob(t, 'image/jpeg', 0.9);
  t.width = t.height = 0;
  return URL.createObjectURL(b);
}

/** Copying images needs the async Clipboard API with PNG support (and a secure page). */
export function canCopyImages(): boolean {
  if (typeof window === 'undefined' || !window.isSecureContext) return false;
  if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') return false;
  const supports = (ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports;
  return typeof supports !== 'function' || supports('image/png');
}

/** Object URLs are revoked a little after the sheet closes, so a download that just started finishes. */
function revokeLater(urls: (string | null | undefined)[]) {
  const list = urls.filter((u): u is string => !!u);
  if (list.length) setTimeout(() => list.forEach((u) => URL.revokeObjectURL(u)), 30_000);
}

let runId = 0;
let noteSeq = 0;

/* Shared by the top bar's Export controls and the sheet. Not undoable, so it stays out of lib/store. */
export const useExport = create<ExportState>()((set, get) => {
  const note = (msg: string) => set({ note: { id: ++noteSeq, msg } });
  const clearMulti = () => {
    const { items, zip } = get();
    revokeLater([...items.flatMap((i) => [i.url, i.thumb]), zip?.url]);
    set({ items: [], zip: null });
  };

  /** Renders `plan` one file at a time into the open sheet, then zips the files. */
  const runMulti = async (
    mode: MultiMode,
    plan: { key: string; label: string; render(): Promise<HTMLCanvasElement>; name(w: number, h: number): string; doc?: Composition }[],
    zipName: string,
    format: Format,
    returnTo: string,
  ) => {
    if (get().rendering) return;
    const id = ++runId;
    clearMulti();
    set({
      mode, open: true, rendering: true, returnTo, note: null,
      items: plan.map((p) => ({ key: p.key, label: p.label, status: 'pending', name: '', w: 0, h: 0, format, blob: null, url: null, thumb: null, ...(p.doc ? { doc: p.doc } : {}) })),
    });
    const update = (i: number, patch: Partial<SheetItem>) => set({ items: get().items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
    for (let i = 0; i < plan.length; i++) {
      await yieldFrame();
      if (id !== runId) return;
      try {
        const c = await plan[i].render();
        const blob = await toBlob(c, mime(format), 0.92);
        const thumb = await thumbnail(c);
        const { width: w, height: h } = c;
        c.width = c.height = 0; // one full-size canvas at a time
        if (id !== runId) { revokeLater([thumb]); return; }
        update(i, { status: 'done', name: plan[i].name(w, h), w, h, blob, url: URL.createObjectURL(blob), thumb });
      } catch (e) {
        if (id !== runId) return;
        update(i, { status: 'error', error: e instanceof Error && e.message === 'no colors' ? 'Couldn’t read the site’s colors.' : 'Couldn’t render this one.' });
      }
    }
    const files = get().items.filter((it) => it.blob).map((it) => ({ name: it.name, blob: it.blob! }));
    try {
      if (files.length) {
        const z = await zipBlobs(files);
        if (id !== runId) return;
        set({ zip: { url: URL.createObjectURL(z), name: zipName, size: z.size } });
      }
    } catch {
      if (id === runId) note('Couldn’t make the zip. Save the files one by one.');
    } finally {
      if (id === runId) set({ rendering: false });
    }
  };

  return {
    open: false,
    mode: 'single',
    rendering: false,
    result: null,
    items: [],
    zip: null,
    note: null,
    returnTo: 'exportBtn',
    async run(returnTo = 'exportBtn') {
      if (get().rendering) return;
      set({ rendering: true });
      const { doc, ui, showToast } = useEditor.getState();
      const snap = clone(doc);
      try {
        const r = await exportComposition(snap, ui.exportFormat, ui.exportScale);
        const prev = get().result;
        if (prev) URL.revokeObjectURL(prev.url);
        clearMulti();
        set({
          result: { ...r, url: URL.createObjectURL(r.blob), doc: snap, m: exportScale(snap.W, snap.H, ui.exportScale) },
          mode: 'single', open: true, returnTo, note: null,
        });
      } catch {
        showToast('Export failed. Try 1× or a smaller canvas size.');
      } finally {
        set({ rendering: false });
      }
    },
    runAllSizes(returnTo = 'exportBtn') {
      const { doc, ui } = useEditor.getState();
      const format = ui.exportFormat;
      const plan = allSizes(clone(doc)).map((it) => ({
        key: it.key,
        label: it.label,
        render: () => renderComposition(it.doc, exportScale(it.doc.W, it.doc.H, it.scale)),
        name: (w: number, h: number) => exportFileName(it.doc, w, h, format),
      }));
      return runMulti('sizes', plan, ALL_SIZES_ZIP, format, returnTo);
    },
    runEtsySet(returnTo = 'exportBtn') {
      const { doc, ui } = useEditor.getState();
      const format = ui.exportFormat;
      const scale = PRESETS.etsy43.scale;
      const render = (it: SetItem) => async () => {
        const m = exportScale(it.doc.W, it.doc.H, scale);
        if (it.kind === 'composition') return renderComposition(it.doc, m);
        if (it.kind === 'pages') return renderPagesGrid(it.doc, it.pages, it.doc.W, it.doc.H, m);
        const slot = it.doc.slots[it.slot];
        const pal = await paletteOf(slot.imageId, loadImage);
        if (!pal) throw new Error('no colors');
        return renderPaletteCard(it.doc, slot, pal, m);
      };
      const plan = etsySet(clone(doc)).map((it, i) => ({
        key: it.key,
        label: it.label,
        render: render(it),
        name: (w: number, h: number) => setFileName(i, it.key, w, h, format),
      }));
      return runMulti('etsy', plan, ETSY_SET_ZIP, format, returnTo);
    },
    async runVariations(returnTo = 'exportBtn') {
      if (get().rendering) return;
      const { doc, ui } = useEditor.getState();
      const snap = clone(doc);
      const format = ui.exportFormat;
      const lead = variationPages(snap)[0];
      const pal = lead ? await paletteOf(lead.imageId, loadImage).catch(() => null) : null;
      const plan = pinVariations(snap, pal ? siteBackgrounds(pal) : null, pageMeasure()).map((v, i) => ({
        key: v.key,
        label: v.label,
        doc: v.doc,
        render: () => renderComposition(v.doc, exportScale(v.doc.W, v.doc.H, ui.exportScale)),
        name: (w: number, h: number) => `layout-stage-${PRESETS[v.doc.preset].slug}-variation-${i + 1}-${w}x${h}.${format === 'jpg' ? 'jpg' : 'png'}`,
      }));
      return runMulti('variations', plan, VARIATIONS_ZIP, format, returnTo);
    },
    async runPagesGrid(returnTo = 'exportBtn') {
      const { doc, ui, showToast } = useEditor.getState();
      if (!hasPages(doc)) {
        showToast('Add two or more pages to Media first: upload them, or capture a whole site.');
        return;
      }
      const format = ui.exportFormat;
      const plan = pagesImages(clone(doc)).map((it) => ({
        key: it.key,
        label: it.label,
        render: () => renderPagesGrid(it.doc, it.pages, it.doc.W, it.doc.H, exportScale(it.doc.W, it.doc.H, PRESETS[it.preset].scale)),
        name: (w: number, h: number) => `layout-stage-all-pages-${PRESETS[it.preset].slug}-${w}x${h}.${format === 'jpg' ? 'jpg' : 'png'}`,
      }));
      return runMulti('pages', plan, PAGES_ZIP, format, returnTo);
    },
    async openVideo(returnTo = 'exportBtn') {
      if (get().rendering) return;
      clearMulti();
      set({ mode: 'video', open: true, returnTo, note: null });
    },
    notify: note,
    copy() {
      const r = get().result;
      if (!r) return;
      // Clipboards take PNG. The write starts inside the click (Safari needs that); the PNG follows.
      const png = r.format === 'png' ? Promise.resolve(r.blob) : renderComposition(r.doc, r.m).then((c) => toBlob(c, 'image/png'));
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
          () => note('Copied.'),
          (e: unknown) => note(e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Copying was blocked by the browser. Use Save file instead.'
            : 'Couldn’t copy the image. Use Save file instead.'),
        );
      } catch {
        note('Couldn’t copy the image. Use Save file instead.');
      }
    },
    close() {
      if (!get().open) return;
      runId++; // stops a multi-image render in progress
      set({ open: false, rendering: false, note: null });
      if (get().mode !== 'single') clearMulti();
      document.getElementById(get().returnTo)?.focus();
    },
  };
});

/* ---------------- the sheet ---------------- */

/** Modal frame shared by both sheets: scrim click and Esc close (Esc via useShortcuts), Tab stays inside. */
function Sheet({ className, children }: { className?: string; children: ReactNode }) {
  const close = useExport((s) => s.close);
  const cardRef = useRef<HTMLDivElement>(null);
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const f = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), video[controls]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const inside = cardRef.current.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  };
  return (
    <div
      className={className ? `sheet ${className}` : 'sheet'} id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={trapTab}
    >
      <div className="sheet-card" ref={cardRef}>
        {children}
        <SheetNote />
      </div>
    </div>
  );
}

/** The in-sheet toast. */
function SheetNote() {
  const note = useExport((s) => s.note);
  const [on, setOn] = useState(false);
  const id = note?.id;
  useEffect(() => {
    if (id == null) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, [id]);
  return <div className={on ? 'sheet-toast show' : 'sheet-toast'} id="sheetToast" role="status" aria-live="polite">{note?.msg}</div>;
}

function Head({ title }: { title: string }) {
  const close = useExport((s) => s.close);
  return (
    <div className="sheet-head">
      <h2 id="sheetTitle">{title}</h2>
      <button className="icon-btn" id="sheetClose" type="button" aria-label="Close" onClick={close}>✕</button>
    </div>
  );
}

function SingleSheet() {
  const result = useExport((s) => s.result)!;
  const close = useExport((s) => s.close);
  const copy = useExport((s) => s.copy);
  const notify = useExport((s) => s.notify);
  const saveRef = useRef<HTMLAnchorElement>(null);
  const [canCopy] = useState(canCopyImages);
  useEffect(() => saveRef.current?.focus(), []);
  const ext = result.format === 'jpg' ? 'JPG' : 'PNG';
  return (
    <Sheet className="split">
      <Head title="Export ready" />
      <div className="sheet-split">
        <div className="sheet-main">
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
            {canCopy && (
              <button className="btn" id="sheetCopy" type="button" onClick={copy} title={result.format === 'jpg' ? 'Copies a PNG of this image' : undefined}>
                Copy
              </button>
            )}
            <a className="btn primary" id="sheetSave" href={result.url} download={result.name} ref={saveRef}>Save file</a>
          </div>
        </div>
        <PinTextSection notify={notify} />
      </div>
    </Sheet>
  );
}

/** The scrolling video sheet; wide once the video is ready, to show the pin text beside it. */
function VideoSheet() {
  const close = useExport((s) => s.close);
  const notify = useExport((s) => s.notify);
  const [wide, setWide] = useState(false);
  return (
    <Sheet className={wide ? 'video split' : 'video'}>
      <Head title="Scrolling video" />
      <VideoBody onClose={close} notify={notify} onWide={setWide} />
    </Sheet>
  );
}

const MULTI_COPY: Record<MultiMode, { title: string; lede: string }> = {
  sizes: { title: 'All sizes', lede: 'The same layouts and style, arranged for each size.' },
  variations: { title: 'Variations', lede: 'Takes on this canvas from the same pages: other layouts, another page in front, backgrounds from the site’s colors. Post several as fresh pins, or put one on the canvas.' },
  pages: { title: 'All pages', lede: 'Every page in Media in one grid, with your background and frame. Good as an Etsy “what’s included” photo.' },
  etsy: { title: 'Etsy listing set', lede: 'Listing photos at 3000 × 2250, in listing order. Etsy takes up to 20 per listing.' },
};

function MultiSheet({ mode }: { mode: MultiMode }) {
  const items = useExport((s) => s.items);
  const zip = useExport((s) => s.zip);
  const rendering = useExport((s) => s.rendering);
  const close = useExport((s) => s.close);
  useEffect(() => document.getElementById('sheetClose')?.focus(), []);
  const done = items.filter((i) => i.status === 'done');
  const current = rendering ? items.findIndex((i) => i.status === 'pending') : -1;
  const at = Math.min(items.length, items.filter((i) => i.status !== 'pending').length + 1);
  const total = done.reduce((n, i) => n + (i.blob?.size ?? 0), 0);
  const status = rendering
    ? `Rendering ${at} of ${items.length}…`
    : `${done.length} ${done.length === 1 ? 'image' : 'images'} · ${fmtBytes(total)}`;
  const { title, lede } = MULTI_COPY[mode];
  const putOnCanvas = (it: SheetItem) => {
    if (!it.doc) return;
    useEditor.getState().putComposition(it.doc);
    close();
    useEditor.getState().showToast(`${it.label.split(' · ')[0]} is on the canvas. Undo goes back.`);
  };
  return (
    <Sheet className="multi">
      <Head title={title} />
      <p className="fine">{lede}</p>
      <ul className="multi-grid" id="multiGrid" aria-label="Files">
        {items.map((it, k) => {
          const ext = it.format === 'jpg' ? 'JPG' : 'PNG';
          return (
            <li key={it.key} className="multi-item" data-status={it.status} aria-busy={k === current}>
              <div className="multi-thumb">
                {it.thumb
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.thumb} alt={`Preview: ${it.label}`} />
                  : <span className="multi-wait">{it.status === 'error' ? 'Not rendered' : k === current ? 'Rendering…' : 'Waiting'}</span>}
              </div>
              <div className="multi-meta">
                <span className="multi-label">{it.label}</span>
                {it.status === 'done' && <strong className="multi-name" title={it.name}>{it.name}</strong>}
                <span className="fine">
                  {it.status === 'done' ? `${it.w} × ${it.h} px · ${ext} · ${fmtBytes(it.blob!.size)}` : it.status === 'error' ? it.error : '…'}
                </span>
              </div>
              {it.status === 'done' && it.url && (
                <span className="multi-buttons">
                  {it.doc && (
                    <button className="btn sm" type="button" aria-label={`Use ${it.label} on the canvas`} onClick={() => putOnCanvas(it)}>Use</button>
                  )}
                  <a className="btn sm" href={it.url} download={it.name} aria-label={`Save ${it.name}`}>Save</a>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="sheet-actions multi-actions">
        <span className="fine multi-status" role="status" aria-live="polite">{status}</span>
        <button className="btn" id="sheetBack" type="button" onClick={close}>Back to editing</button>
        {zip ? (
          <a className="btn primary" id="sheetSaveAll" href={zip.url} download={zip.name}>Save all (.zip)</a>
        ) : (
          <button className="btn primary" id="sheetSaveAll" type="button" disabled>Save all (.zip)</button>
        )}
      </div>
    </Sheet>
  );
}

export default function ExportSheet() {
  const open = useExport((s) => s.open);
  const mode = useExport((s) => s.mode);
  const hasResult = useExport((s) => !!s.result);
  if (!open) return null;
  if (mode === 'single') return hasResult ? <SingleSheet /> : null;
  if (mode === 'video') return <VideoSheet />;
  return <MultiSheet key={mode} mode={mode} />;
}
