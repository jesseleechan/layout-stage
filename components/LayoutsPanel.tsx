'use client';
import { useRef, useState, type DragEvent } from 'react';
import { captureJobSlot, useEditor, type CaptureJob } from '@/lib/store';
import { useThumbUrl } from '@/lib/images';
import { Seg, type Option } from './controls';
import './panels.css';

const COUNT_OPTIONS: Option<1 | 2 | 3>[] = [
  {
    value: 1,
    label: (
      <>
        <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="7" y="3" width="16" height="12" rx="2" fill="currentColor" fillOpacity=".14" />
        </svg>
        1
      </>
    ),
  },
  {
    value: 2,
    label: (
      <>
        <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="4" y="2" width="14" height="10" rx="2" />
          <rect x="12" y="6.5" width="14" height="10" rx="2" fill="currentColor" fillOpacity=".14" />
        </svg>
        2
      </>
    ),
  },
  {
    value: 3,
    label: (
      <>
        <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="2.5" y="1" width="12" height="8.5" rx="1.8" />
          <rect x="9" y="4.8" width="12" height="8.5" rx="1.8" />
          <rect x="15.5" y="8.5" width="12" height="8.5" rx="1.8" fill="currentColor" fillOpacity=".14" />
        </svg>
        3
      </>
    ),
  },
];

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

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function SlotRow({ i, count, on, busy, onReplace }: { i: number; count: number; on: boolean; busy: boolean; onReplace: (i: number) => void }) {
  const imageId = useEditor((s) => s.doc.slots[i].imageId);
  const name = useEditor((s) => s.doc.slots[i].name);
  const nw = useEditor((s) => s.doc.slots[i].nw);
  const nh = useEditor((s) => s.doc.slots[i].nh);
  const kind = useEditor((s) => s.doc.slots[i].source.kind);
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
        <button type="button" className="icon-btn xs" data-act="replace" aria-label={`Replace layout ${n}`} title="Replace image" onClick={() => onReplace(i)}>
          <ReplaceIcon />
        </button>
        <button
          type="button"
          className="icon-btn xs"
          data-act="replace-url"
          aria-label={`Replace layout ${n} from URL`}
          title="Replace from URL"
          onClick={() => useEditor.getState().openCapture(i)}
        >
          <GlobeIcon />
        </button>
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
  const setCount = useEditor((s) => s.setCount);
  const openCapture = useEditor((s) => s.openCapture);
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
        <h2>Layouts</h2>
        <span className="note">1 to 3 images</span>
      </div>
      <Seg className="count" label="Number of layouts" options={COUNT_OPTIONS} value={count} onPick={setCount} />
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
