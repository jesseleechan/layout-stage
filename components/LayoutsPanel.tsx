'use client';
import { useRef, useState, type DragEvent } from 'react';
import { captureJobSlot, useEditor, type CaptureJob } from '@/lib/store';
import { canContinuePage, pageMeasure } from '@/lib/arrange';
import { useThumbUrl } from '@/lib/images';
import { recapture, recaptureAll } from '@/lib/capture/jobs';
import { hostOf, recapturable } from '@/lib/capture/recapture';
import ReplaceMenu, { type MenuItem } from './ReplaceMenu';
import './panels.css';

const ReplaceIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6" />
    <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="5.75" />
    <path d="M2.25 8h11.5" />
    <path d="M8 2.25c1.5 1.6 2.25 3.5 2.25 5.75S9.5 12.15 8 13.75C6.5 12.15 5.75 10.25 5.75 8S6.5 3.85 8 2.25Z" />
  </svg>
);

const RecaptureIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.25 8A5.25 5.25 0 1 1 11.6 4.2" />
    <path d="M13.5 2.5v3.25h-3.25" />
  </svg>
);

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

function SlotRow({ i, count, on, busy, onReplace }: { i: number; count: number; on: boolean; busy: boolean; onReplace: (i: number) => void }) {
  const imageId = useEditor((s) => s.doc.slots[i].imageId);
  const name = useEditor((s) => s.doc.slots[i].name);
  const nw = useEditor((s) => s.doc.slots[i].nw);
  const nh = useEditor((s) => s.doc.slots[i].nh);
  const kind = useEditor((s) => s.doc.slots[i].source.kind);
  const pageUrl = useEditor((s) => { const src = s.doc.slots[i].source; return src.kind === 'url' ? src.url : null; });
  // The second of two showcase columns can continue a long page in the first one.
  const canContinue = useEditor((s) => i === 1 && s.doc.slots[1].imageId !== s.doc.slots[0].imageId && canContinuePage(s.doc, pageMeasure()));
  const url = useThumbUrl(imageId);
  const [over, setOver] = useState(false);
  const n = i + 1;
  const meta = busy ? 'Capturing…' : `${nw}×${nh}${kind === 'sample' ? ' · sample' : kind === 'url' ? ' · from URL' : ''}`;

  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    // The first image; a non-image goes through so the store can say which formats work.
    const f = files.find((f) => f.type.startsWith('image/')) ?? files[0];
    if (f) void useEditor.getState().placeFiles([f], i);
  };

  return (
    <li
      className={'slot' + (on ? ' on' : '') + (over ? ' dragover' : '')}
      data-i={i}
      aria-busy={busy || undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        className="slot-pick"
        type="button"
        aria-label={`Select layout ${n}`}
        aria-current={on || undefined}
        title={name}
        onClick={() => useEditor.getState().select(i)}
      >
        <span className="slot-num">{n}</span>
        <img className="slot-thumb" alt="" src={url ?? undefined} />
        <span className="slot-text">
          <span className="slot-name">{name}</span>
          <span className="slot-meta">{meta}</span>
        </span>
      </button>
      <div className="slot-actions">
        <ReplaceMenu label={`Replace layout ${n}`} title="Replace image" icon={<ReplaceIcon />} items={replaceItems(i, pageUrl, busy, onReplace, canContinue)} />
        <button
          type="button"
          className="icon-btn xs"
          data-act="remove"
          aria-label={`Remove layout ${n}`}
          title="Remove"
          hidden={count < 2}
          onClick={() => useEditor.getState().removeSlot(i)}
        >
          ×
        </button>
      </div>
    </li>
  );
}

const ContinueIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 1.5h4v13h-4M9.5 14.5h4v-13h-4" />
    <path d="M6.5 11 9.5 5" />
  </svg>
);

/** Replace menu: a file, a URL, (for a layout captured from a URL) the same page again, or (for the
 *  second showcase column) the rest of layout 1's page. */
function replaceItems(i: number, pageUrl: string | null, busy: boolean, onReplace: (i: number) => void, canContinue: boolean): MenuItem[] {
  const items: MenuItem[] = [
    { key: 'replace-file', label: 'Upload a file…', icon: <ReplaceIcon />, onSelect: () => onReplace(i) },
    { key: 'replace-url', label: 'Capture from URL…', icon: <GlobeIcon />, onSelect: () => useEditor.getState().openCapture(i) },
  ];
  if (pageUrl) items.push({ key: 'recapture', label: `Re-capture ${hostOf(pageUrl)}`, icon: <RecaptureIcon />, disabled: busy, onSelect: () => void recapture(i) });
  if (canContinue) items.push({ key: 'continue', label: 'Continue layout 1’s page', icon: <ContinueIcon />, onSelect: () => useEditor.getState().continuePage(i) });
  return items;
}

/** A capture with no target slot yet: it will land by the drop-elsewhere rule. */
function PendingRow({ job }: { job: CaptureJob }) {
  const host = hostOf(job.url);
  return (
    <li className="slot slot-pending" aria-busy="true" title={job.url}>
      <span className="slot-pick">
        <span className="slot-num" aria-hidden="true">+</span>
        <span className="slot-thumb" aria-hidden="true" />
        <span className="slot-text">
          <span className="slot-name">Capturing…</span> <span className="slot-meta">{host}</span>
        </span>
      </span>
    </li>
  );
}

export default function LayoutsPanel() {
  const count = useEditor((s) => s.doc.count);
  const selected = useEditor((s) => s.ui.selected);
  const jobs = useEditor((s) => s.captureJobs);
  // Where each capture will land now ("" = the drop-elsewhere rule); a string so drags don't re-render.
  const jobSlots = useEditor((s) => s.captureJobs.map((j) => captureJobSlot(s.doc, j) ?? '').join(','));
  const slotOf = (k: number) => jobSlots.split(',')[k];
  const openCapture = useEditor((s) => s.openCapture);
  // Layouts captured from a URL, and how many of them aren't capturing now (for Re-capture all).
  const fromUrl = useEditor((s) => recapturable(s.doc).length);
  const idle = useEditor((s) => recapturable(s.doc).filter((r) => !s.captureJobs.some((j) => captureJobSlot(s.doc, j) === r.i)).length);
  const manyRef = useRef<HTMLInputElement>(null);
  const oneRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef(0);

  const replace = (i: number) => {
    replaceTarget.current = i;
    oneRef.current?.click();
  };

  return (
    <section className="group">
      <div className="group-head">
        <h2>Screenshots</h2>
        <span className="note">1 to 3</span>
      </div>
      <ol className="slots" id="slots">
        {Array.from({ length: count }, (_, i) => (
          <SlotRow key={i} i={i} count={count} on={selected === i} busy={jobs.some((_, k) => slotOf(k) === String(i))} onReplace={replace} />
        ))}
        {jobs
          .filter((_, k) => slotOf(k) === '')
          .map((j) => (
            <PendingRow key={j.id} job={j} />
          ))}
      </ol>
      {fromUrl >= 2 && (
        <button className="btn sm wide" id="recaptureAllBtn" type="button" disabled={!idle} onClick={() => void recaptureAll()}>
          <RecaptureIcon />
          Re-capture all
        </button>
      )}
      <div className="btn-grid">
        <button className="btn" id="uploadBtn" type="button" onClick={() => manyRef.current?.click()}>
          Upload screenshots…
        </button>
        <button className="btn" id="fromUrlBtn" type="button" onClick={() => openCapture(null)}>
          From URL…
        </button>
      </div>
      <p className="fine">Or drop up to three files on the canvas, or paste one with Ctrl/⌘&nbsp;V.</p>
      <input
        ref={manyRef}
        type="file"
        id="fileMany"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) void useEditor.getState().placeFiles(files, null);
        }}
      />
      <input
        ref={oneRef}
        type="file"
        id="fileOne"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void useEditor.getState().placeFiles([f], replaceTarget.current);
        }}
      />
    </section>
  );
}
