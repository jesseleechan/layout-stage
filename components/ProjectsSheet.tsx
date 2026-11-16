'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { loadImage } from '@/lib/images';
import { paletteOf } from '@/lib/palette';
import { PIN_TEXT_FILE, pinTextFile } from '@/lib/pin-text';
import { useProjects, statusOf } from '@/lib/projects/library';
import { readThumb } from '@/lib/projects/local';
import { editedAgo, listedProjects, megabytes, type LocalProject } from '@/lib/projects/model';
import { renderComposition } from '@/lib/render/export';
import { renderPagesGrid } from '@/lib/render/pages-grid';
import { renderPaletteCard } from '@/lib/render/palette-card';
import { etsySet } from '@/lib/sets';
import { useEditor } from '@/lib/store';
import { zipBlobs } from '@/lib/zip';
import { NameInput } from './ProjectsControl';

/* The projects list: a sheet over the editor with a card per project (thumbnail, name, last edited)
   and New, Open, Rename, Duplicate and Delete (with a confirm). A modal dialog: focus stays inside,
   Esc closes it (or cancels a rename or delete first), focus returns to the Projects button. */
export default function ProjectsSheet() {
  const open = useProjects((s) => s.sheetOpen);
  return open ? <Sheet /> : null;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

function Sheet() {
  const items = useProjects((s) => s.items);
  const currentId = useProjects((s) => s.currentId);
  const mode = useProjects((s) => s.mode);
  const phase = useProjects((s) => s.phase);
  const transfer = useProjects((s) => s.transfer);
  const opening = useProjects((s) => s.opening);
  const pendingDeletes = useProjects((s) => s.pendingDeletes);
  const { closeSheet, create } = useProjects.getState();
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const downOnScrim = useRef(false);
  const uid = useId();
  const status = statusOf({ ...useProjects.getState(), items, mode, phase, transfer, pendingDeletes });
  const openingName = opening ? items.find((p) => p.id === opening)?.name : null;
  const shown = listedProjects(items, mode);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBatchEtsy = async () => {
    if (batching || !selected.length) return;
    const { readProjectDoc } = useProjects.getState();
    const { showToast } = useEditor.getState();
    const usedFolders = new Set<string>();
    const files: { name: string; blob: Blob }[] = [];
    try {
      for (const id of selected) {
        const p = shown.find((x) => x.id === id);
        if (!p || p.stub) continue;
        setBatching(p.name);
        const doc = await readProjectDoc(id);
        if (!doc) continue;
        const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
        let folder = base;
        for (let k = 2; usedFolders.has(folder); k++) folder = `${base}-${k}`;
        usedFolders.add(folder);

        const plan = etsySet(doc);
        const texts: { file: string; doc: typeof doc }[] = [];
        for (const item of plan) {
          let c: HTMLCanvasElement;
          if (item.kind === 'pages') {
            c = await renderPagesGrid(item.doc, item.pages, item.doc.W, item.doc.H, 1);
          } else if (item.kind === 'palette') {
            const slot = item.doc.slots[item.slot];
            const pal = await paletteOf(slot.imageId, loadImage);
            if (!pal) continue;
            c = await renderPaletteCard(item.doc, slot, pal, 1);
          } else {
            c = await renderComposition(item.doc, 1);
          }
          const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
          c.width = 0;
          c.height = 0;
          if (!blob) continue;
          const fileName = `${item.key}.png`;
          files.push({ name: `${folder}/${fileName}`, blob });
          if (item.key === 'hero') texts.push({ file: fileName, doc: item.doc });
        }
        if (texts.length) {
          files.push({ name: `${folder}/${PIN_TEXT_FILE}`, blob: new Blob([pinTextFile(texts)], { type: 'text/plain;charset=utf-8' }) });
        }
      }
      if (!files.length) { showToast('Nothing could be exported.'); return; }
      const z = await zipBlobs(files);
      const url = URL.createObjectURL(z);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'layout-stage-etsy-batch.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      showToast('Couldn’t make the batch Etsy zip.');
    } finally {
      setBatching(null);
    }
  };

  // Focus the open project's card; give focus back to whatever opened the sheet.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? listRef.current?.querySelector<HTMLElement>('.proj-open');
    first?.focus();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    // Keys while focus is outside the sheet (on the page behind, after a card it was on went away):
    // the editor's shortcuts stay out, Esc still closes, Tab comes back in.
    const outside = (e: globalThis.KeyboardEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        useProjects.getState().closeSheet();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      }
    };
    document.addEventListener('keydown', outside, true);
    return () => {
      clearInterval(t);
      document.removeEventListener('keydown', outside, true);
      if (prev?.isConnected) prev.focus();
      else document.getElementById('projectsBtn')?.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The editor's shortcuts (nudge, undo, deselect) stay out while the sheet is open.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** After a delete: the next card, else the New button. */
  const focusAfter = (index: number) => {
    requestAnimationFrame(() => {
      const opens = listRef.current?.querySelectorAll<HTMLElement>('.proj-open');
      (opens?.[Math.min(index, (opens?.length ?? 1) - 1)] ?? document.getElementById(`${uid}new`))?.focus();
    });
  };

  return (
    <div
      className="sheet projects" role="dialog" aria-modal="true" aria-labelledby={`${uid}t`} aria-describedby={`${uid}d`}
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnScrim.current && e.target === e.currentTarget) closeSheet();
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="sheet-card proj-card-wrap" ref={cardRef}>
        <div className="sheet-head">
          <h2 id={`${uid}t`}>Projects</h2>
          <div className="proj-head-actions">
            {selected.length > 0 && (
              <button className="btn sm" type="button" disabled={!!opening || !!batching} onClick={() => void runBatchEtsy()}>
                {batching ? `Exporting ${batching}…` : `Etsy sets (${selected.length})`}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void useProjects.getState().openFile(file);
              }}
            />
            <button className="btn sm" type="button" disabled={!!opening || !!batching} onClick={() => fileRef.current?.click()}>
              Open file…
            </button>
            <button className="btn primary sm" id={`${uid}new`} type="button" disabled={!!opening || !!batching} onClick={() => void create()}>
              New project
            </button>
            <button className="icon-btn" type="button" aria-label="Close" onClick={closeSheet}>
              ✕
            </button>
          </div>
        </div>
        <p className="fine proj-note" id={`${uid}d`} data-state={status.key}>
          <span className="proj-dot" aria-hidden="true" />
          {status.detail}
        </p>
        <ul className="proj-grid" ref={listRef} aria-label="Your projects">
          {shown.map((p, i) => (
            <Card
              key={p.id}
              p={p}
              current={p.id === currentId}
              now={now}
              syncOn={mode === 'blob' || mode === 'local'}
              busy={!!opening || !!batching}
              opening={opening === p.id}
              picked={selected.includes(p.id)}
              onToggle={() => toggleSelect(p.id)}
              onDeleted={() => focusAfter(i)}
            />
          ))}
        </ul>
        {opening && (
          <div className="proj-progress" role="status" aria-live="polite">
            <div className="proj-progress-text">
              <span>{`Opening “${openingName ?? 'project'}”`}</span>
              <span className="proj-progress-num">
                {transfer && transfer.dir === 'down' && transfer.total > 0 ? `${megabytes(transfer.loaded)} of ${megabytes(transfer.total)}` : 'Getting it ready…'}
              </span>
            </div>
            <progress max={transfer?.total || 1} value={transfer && transfer.dir === 'down' ? transfer.loaded : undefined} aria-label="Download progress" />
            <button className="btn sm" type="button" onClick={() => useProjects.getState().cancelOpen()}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A project's thumbnail from this browser (object URL; the previous one is kept until the next loads). */
function useProjectThumb(id: string, stamp: number | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    let on = true;
    void readThumb(id).then((b) => {
      if (!on || !b) return;
      const next = URL.createObjectURL(b);
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = next;
      setUrl(next);
    });
    return () => {
      on = false;
    };
  }, [id, stamp]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );
  return url;
}

function Card({ p, current, now, syncOn, busy, opening, picked, onToggle, onDeleted }: {
  p: LocalProject; current: boolean; now: number; syncOn: boolean; busy: boolean; opening: boolean; picked: boolean; onToggle(): void; onDeleted(): void;
}) {
  const { open, rename, duplicate, remove } = useProjects.getState();
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm'>('idle');
  const thumb = useProjectThumb(p.id, p.thumbAt);
  const uid = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const save = async () => {
    const got = await useProjects.getState().download(p.id);
    if (!got) return;
    const url = URL.createObjectURL(got.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = got.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  useEffect(() => {
    if (mode === 'confirm') cancelRef.current?.focus();
  }, [mode]);

  const ago = editedAgo(p.updatedAt, now);
  const meta = [current ? 'Open now' : null, `Edited ${/^(Just|Yesterday)/.test(ago) ? ago.toLowerCase() : ago}`, p.stub ? 'On another device' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="proj-card" data-current={current || undefined} data-stub={p.stub || undefined}>
      {!p.stub && (
        <input
          className="proj-pick"
          type="checkbox"
          checked={picked}
          disabled={busy}
          aria-label={`Select ${p.name} for batch export`}
          onChange={onToggle}
        />
      )}
      <button
        className="proj-open" type="button" aria-current={current ? 'true' : undefined} disabled={busy && !opening}
        aria-label={`Open ${p.name}`} aria-describedby={`${uid}m`} onClick={() => void open(p.id)}
      >
        <span className="proj-thumb">
          {thumb ? <img src={thumb} alt="" /> : <span className="proj-thumb-empty" aria-hidden="true" />}
          {opening && <span className="proj-opening">Opening…</span>}
        </span>
      </button>
      <div className="proj-info">
        {mode === 'rename' ? (
          <NameInput
            name={p.name}
            label={`Rename ${p.name}`}
            onDone={(next) => {
              setMode('idle');
              if (next != null) void rename(p.id, next);
              requestAnimationFrame(() => renameRef.current?.focus());
            }}
          />
        ) : (
          <span className="proj-card-name" title={p.name}>{p.name}</span>
        )}
        <span className="proj-card-meta" id={`${uid}m`}>{meta}</span>
      </div>
      {mode === 'confirm' ? (
        <div
          className="proj-confirm" role="group" aria-labelledby={`${uid}q`}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setMode('idle');
            requestAnimationFrame(() => deleteRef.current?.focus());
          }}
        >
          <p id={`${uid}q`}>{syncOn ? `Delete “${p.name}” from all your devices?` : `Delete “${p.name}”? This can’t be undone.`}</p>
          <div className="proj-confirm-actions">
            <button className="btn sm proj-danger" type="button" onClick={() => {
              setMode('idle');
              void remove(p.id).then(onDeleted);
            }}>
              Delete
            </button>
            <button className="btn sm" type="button" ref={cancelRef} onClick={() => {
              setMode('idle');
              requestAnimationFrame(() => deleteRef.current?.focus());
            }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="proj-actions">
          <button className="icon-btn xs" type="button" ref={renameRef} aria-label={`Rename ${p.name}`} title="Rename" disabled={busy} onClick={() => setMode('rename')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z" /></svg>
          </button>
          <button
            className="icon-btn xs" type="button" aria-label={`Duplicate ${p.name}`} title={p.stub ? 'Open it first, then duplicate it' : 'Duplicate'}
            disabled={busy || p.stub} onClick={() => void duplicate(p.id)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M11 3.2V3a.5.5 0 0 0-.5-.5h-7A.5.5 0 0 0 3 3v7.5a.5.5 0 0 0 .5.5h.2" /></svg>
          </button>
          <button
            className="icon-btn xs" type="button" aria-label={`Download ${p.name}`} title={p.stub ? 'Open it first, then download it' : 'Download'}
            disabled={busy || p.stub} onClick={() => void save()}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13h10" /></svg>
          </button>
          <button className="icon-btn xs" type="button" ref={deleteRef} aria-label={`Delete ${p.name}`} title="Delete" disabled={busy} onClick={() => setMode('confirm')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" /></svg>
          </button>
        </div>
      )}
    </li>
  );
}
