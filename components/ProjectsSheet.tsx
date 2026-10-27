'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { statusOf, useProjects } from '@/lib/projects/library';
import { readThumb } from '@/lib/projects/local';
import { editedAgo, listedProjects, megabytes, type LocalProject } from '@/lib/projects/model';
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
  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const downOnScrim = useRef(false);
  const uid = useId();
  const status = statusOf({ ...useProjects.getState(), items, mode, phase, transfer, pendingDeletes });
  const openingName = opening ? items.find((p) => p.id === opening)?.name : null;
  const shown = listedProjects(items, mode);

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
            <button className="btn primary sm" id={`${uid}new`} type="button" disabled={!!opening} onClick={() => void create()}>
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
            <Card key={p.id} p={p} current={p.id === currentId} now={now} syncOn={mode === 'blob' || mode === 'local'} busy={!!opening} opening={opening === p.id} onDeleted={() => focusAfter(i)} />
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

function Card({ p, current, now, syncOn, busy, opening, onDeleted }: {
  p: LocalProject; current: boolean; now: number; syncOn: boolean; busy: boolean; opening: boolean; onDeleted(): void;
}) {
  const { open, rename, duplicate, remove } = useProjects.getState();
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm'>('idle');
  const thumb = useProjectThumb(p.id, p.thumbAt);
  const uid = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === 'confirm') cancelRef.current?.focus();
  }, [mode]);

  const ago = editedAgo(p.updatedAt, now);
  const meta = [current ? 'Open now' : null, `Edited ${/^(Just|Yesterday)/.test(ago) ? ago.toLowerCase() : ago}`, p.stub ? 'On another device' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="proj-card" data-current={current || undefined} data-stub={p.stub || undefined}>
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
          <button className="icon-btn xs" type="button" ref={deleteRef} aria-label={`Delete ${p.name}`} title="Delete" disabled={busy} onClick={() => setMode('confirm')}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" /></svg>
          </button>
        </div>
      )}
    </li>
  );
}
