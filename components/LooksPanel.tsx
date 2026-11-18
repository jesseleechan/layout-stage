'use client';
import type { CSSProperties } from 'react';
import { STYLES, type Style } from '@/lib/model';
import { useEditor } from '@/lib/store';

function lookPreview(st: Style): string {
  const b = st.background;
  if (b.type === 'gradient' && b.grad) return `linear-gradient(${b.grad.angle}deg, ${b.grad.a}, ${b.grad.b})`;
  if (b.type === 'mesh' && b.mesh) return `radial-gradient(circle at 25% 25%, ${b.mesh[1]}, transparent 65%), radial-gradient(circle at 80% 75%, ${b.mesh[2]}, ${b.mesh[0]})`;
  return b.solid ?? '#F4F5F7';
}

function lookSwatchProps(st: Style): { className: string; style?: CSSProperties } {
  if (st.background.type === 'transparent') return { className: 'look-sw checker', style: { '--checker': '8px' } as CSSProperties };
  return { className: 'look-sw', style: { background: lookPreview(st) } };
}

/* One-click looks in the Canvas tab: the nine built-in styles plus any saved in this browser. */
export default function LooksPanel() {
  const savedStyles = useEditor((s) => s.savedStyles);
  const { applyStyle, saveStyle, deleteStyle } = useEditor.getState();

  return (
    <section className="group" aria-label="Looks">
      <div className="group-head">
        <h2>Looks</h2>
        <button className="btn xs" type="button" onClick={() => void saveStyle()}>
          Save look
        </button>
      </div>
      <div className="looks-row">
        {STYLES.map((st) => (
          <button
            key={st.name}
            className="look-pill"
            type="button"
            title={st.name}
            onClick={() => applyStyle(st)}
          >
            <span {...lookSwatchProps(st)} aria-hidden="true" />
            <span>{st.name}</span>
          </button>
        ))}
        {savedStyles.map((st, i) => (
          <div key={`${st.name}-${i}`} className="look-saved">
            <button
              className="look-pill"
              type="button"
              title={st.name}
              onClick={() => applyStyle(st)}
            >
              <span {...lookSwatchProps(st)} aria-hidden="true" />
              <span>{st.name}</span>
            </button>
            <button
              className="look-del"
              type="button"
              aria-label={`Delete ${st.name}`}
              title={`Delete ${st.name}`}
              onClick={() => void deleteStyle(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
