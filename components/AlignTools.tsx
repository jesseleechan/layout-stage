'use client';
import type { ReactNode } from 'react';
import { useEditor } from '@/lib/store';
import type { AlignEdge } from '@/lib/align';
import './canvas-tools.css';

/* Align the other visible layouts to the selected one, or space all visible layouts evenly.
   Each click is one undo step (see lib/align.ts for the rules). */

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    {children}
  </svg>
);

const ALIGN: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left edges', icon: <><path d="M2 1.5v13" fill="none" /><rect x="4" y="3.5" width="9" height="3" rx=".8" stroke="none" /><rect x="4" y="9.5" width="5.5" height="3" rx=".8" stroke="none" /></> },
  { edge: 'center', label: 'Align centers', icon: <><path d="M8 1.5v13" fill="none" /><rect x="3" y="3.5" width="10" height="3" rx=".8" stroke="none" /><rect x="5" y="9.5" width="6" height="3" rx=".8" stroke="none" /></> },
  { edge: 'right', label: 'Align right edges', icon: <><path d="M14 1.5v13" fill="none" /><rect x="3" y="3.5" width="9" height="3" rx=".8" stroke="none" /><rect x="6.5" y="9.5" width="5.5" height="3" rx=".8" stroke="none" /></> },
  { edge: 'top', label: 'Align top edges', icon: <><path d="M1.5 2h13" fill="none" /><rect x="3.5" y="4" width="3" height="9" rx=".8" stroke="none" /><rect x="9.5" y="4" width="3" height="5.5" rx=".8" stroke="none" /></> },
  { edge: 'middle', label: 'Align middles', icon: <><path d="M1.5 8h13" fill="none" /><rect x="3.5" y="3" width="3" height="10" rx=".8" stroke="none" /><rect x="9.5" y="5" width="3" height="6" rx=".8" stroke="none" /></> },
  { edge: 'bottom', label: 'Align bottom edges', icon: <><path d="M1.5 14h13" fill="none" /><rect x="3.5" y="3" width="3" height="9" rx=".8" stroke="none" /><rect x="9.5" y="6.5" width="3" height="5.5" rx=".8" stroke="none" /></> },
];

const DISTRIBUTE: { axis: 'h' | 'v'; label: string; icon: ReactNode }[] = [
  { axis: 'h', label: 'Distribute horizontally', icon: <><path d="M1.5 1.5v13M14.5 1.5v13" fill="none" /><rect x="6" y="4" width="4" height="8" rx=".8" stroke="none" /></> },
  { axis: 'v', label: 'Distribute vertically', icon: <><path d="M1.5 1.5h13M1.5 14.5h13" fill="none" /><rect x="4" y="6" width="8" height="4" rx=".8" stroke="none" /></> },
];

export default function AlignTools({ i }: { i: number }) {
  const count = useEditor((st) => st.doc.count);
  const { align, distribute } = useEditor.getState();
  const canAlign = count >= 2, canSpread = count >= 3;
  const to = `Layout ${i + 1}`;
  return (
    <>
      <div className="sub">Align &amp; distribute</div>
      <div className="align-tools">
        <div role="group" aria-label={`Align to ${to}`} style={{ flex: 3 }}>
          {ALIGN.slice(0, 3).map((a) => (
            <AlignButton key={a.edge} label={`${a.label} to ${to}`} disabled={!canAlign} onClick={() => align(a.edge)}>{a.icon}</AlignButton>
          ))}
        </div>
        <div role="group" aria-label={`Align to ${to}, vertically`} style={{ flex: 3 }}>
          {ALIGN.slice(3).map((a) => (
            <AlignButton key={a.edge} label={`${a.label} to ${to}`} disabled={!canAlign} onClick={() => align(a.edge)}>{a.icon}</AlignButton>
          ))}
        </div>
        <div role="group" aria-label="Distribute" style={{ flex: 2 }}>
          {DISTRIBUTE.map((a) => (
            <AlignButton key={a.axis} label={`${a.label}, equal gaps${canSpread ? '' : ' (needs 3 layouts)'}`} disabled={!canSpread} onClick={() => distribute(a.axis)}>{a.icon}</AlignButton>
          ))}
        </div>
      </div>
      <p className="fine">{canAlign ? `Align moves the other layouts to ${to}.` : 'Add another layout to align or distribute.'}</p>
    </>
  );
}

function AlignButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="icon-btn" type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon>{children}</Icon>
    </button>
  );
}
