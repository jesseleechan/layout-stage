'use client';
import { useEffect, useRef, useState } from 'react';
import { statusOf, useProjects } from '@/lib/projects/library';
import './projects.css';

/* The projects control at the left of the top bar: a button that opens the projects list, the open
   project's name (click to rename) and the sync status. */
export default function ProjectsControl() {
  const items = useProjects((s) => s.items);
  const currentId = useProjects((s) => s.currentId);
  const mode = useProjects((s) => s.mode);
  const phase = useProjects((s) => s.phase);
  const transfer = useProjects((s) => s.transfer);
  const pendingDeletes = useProjects((s) => s.pendingDeletes);
  const sheetOpen = useProjects((s) => s.sheetOpen);
  const [editing, setEditing] = useState(false);
  const nameBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void useProjects.getState().start();
  }, []);

  const current = items.find((p) => p.id === currentId);
  const name = current?.name ?? 'Untitled';
  const status = statusOf({ ...useProjects.getState(), items, mode, phase, transfer, pendingDeletes });

  return (
    <div className="proj" role="group" aria-label="Project">
      <button
        className="icon-btn proj-list-btn" id="projectsBtn" type="button" aria-label="Projects" title="Projects"
        aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => useProjects.getState().openSheet()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" />
        </svg>
      </button>
      {editing && current ? (
        <NameInput
          name={name}
          onDone={(next) => {
            setEditing(false);
            if (next != null) void useProjects.getState().rename(current.id, next);
            requestAnimationFrame(() => nameBtn.current?.focus());
          }}
        />
      ) : (
        <button
          className="proj-name" id="projectName" type="button" ref={nameBtn} disabled={!current}
          title="Rename project" aria-label={`Project name: ${name}. Rename`} onClick={() => setEditing(true)}
        >
          {name}
        </button>
      )}
      {/* Not a live region: syncing comes and goes all the time. The words stay readable here. */}
      <span className="proj-status" data-state={status.key} title={status.detail}>
        <span className="proj-dot" aria-hidden="true" />
        <span className="proj-status-text">{status.label}</span>
      </span>
    </div>
  );
}

/** Inline name field: Enter or leaving it saves, Esc cancels (onDone(null)). */
export function NameInput({ name, onDone, label = 'Project name' }: { name: string; onDone(next: string | null): void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref} className="proj-name-input" type="text" defaultValue={name} maxLength={80} aria-label={label}
      autoComplete="off" spellCheck={false}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
    />
  );
}
