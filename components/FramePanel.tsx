'use client';
import { useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SHADOW_PRESETS, SHADOWS, type ShadowPreset } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { ColorRow, RangeRow, Tiles, type TileOption } from './controls';

/* Frame of every layout, as Shots lays it out: corner tiles with a radius slider, the border, shadow
   tiles with the fine controls behind "Adjust shadow". */

/** Corner presets: Sharp, Curved and Round, in units. */
const CORNERS = [
  { id: 'sharp', label: 'Sharp', radius: 0, path: 'M8 22V8h14' },
  { id: 'curved', label: 'Curved', radius: 14, path: 'M8 22v-6a8 8 0 0 1 8-8h6' },
  { id: 'round', label: 'Round', radius: 36, path: 'M8 22c0-7.7 6.3-14 14-14' },
] as const;
type CornerId = (typeof CORNERS)[number]['id'];

const CORNER_OPTIONS: TileOption<CornerId>[] = CORNERS.map((c) => ({
  value: c.id,
  label: c.label,
  face: (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d={c.path} />
    </svg>
  ),
}));

/** Each shadow preset drawn as a little card with that shadow (scaled down to tile size). */
const SHADOW_OPTIONS: TileOption<Exclude<ShadowPreset, 'custom'>>[] = SHADOW_PRESETS.map((p) => {
  const s = SHADOWS[p.id];
  const k = 0.16;
  const card: CSSProperties = {
    width: '58%', height: '52%', borderRadius: 5, background: 'var(--paper)',
    boxShadow: s.opacity > 0 ? `${s.x * k}px ${s.y * k}px ${s.blur * k}px rgba(20, 20, 22, ${Math.min(0.9, s.opacity + 0.12)})` : 'inset 0 0 0 1px var(--line)',
  };
  return { value: p.id, label: p.label, face: <span style={card} /> };
});

export default function FramePanel() {
  const f = useEditor(
    useShallow((s) => {
      const { radius, borderW, borderC, shadow } = s.doc.frame;
      return { radius, borderW, borderC, preset: shadow.preset, blur: shadow.blur, x: shadow.x, y: shadow.y, opacity: shadow.opacity, color: shadow.color };
    }),
  );
  const { editFrame, editShadow, setShadowPreset, change } = useEditor.getState();
  const [adjust, setAdjust] = useState(false);
  const corner = CORNERS.find((c) => c.radius === f.radius)?.id ?? null;

  return (
    <>
      <section className="group">
        <div className="group-head">
          <h2>Corners</h2>
        </div>
        <Tiles
          label="Corners" options={CORNER_OPTIONS} value={corner} ratio={1.6}
          onPick={(id) => change((d) => { d.frame.radius = CORNERS.find((c) => c.id === id)!.radius; })}
        />
        <RangeRow id="fRadius" label="Radius" min={0} max={80} value={f.radius} onInput={(v) => editFrame({ radius: v })} />
      </section>
      <section className="group">
        <div className="group-head">
          <h2>Border</h2>
        </div>
        <RangeRow id="fBorderW" label="Width" min={0} max={16} value={f.borderW} onInput={(v) => editFrame({ borderW: v })} />
        <ColorRow id="fBorderC" label="Color" value={f.borderC} onInput={(v) => editFrame({ borderC: v })} />
      </section>
      <section className="group">
        <div className="group-head">
          <h2>Shadow</h2>
          <span className="note">All layouts</span>
        </div>
        <Tiles label="Shadow style" options={SHADOW_OPTIONS} value={f.preset === 'custom' ? null : f.preset} columns={5} ratio={1} onPick={setShadowPreset} />
        <RangeRow id="sOp" label="Strength" min={0} max={1} step={0.01} value={f.opacity} format="pct" onInput={(v) => editShadow({ opacity: v })} />
        <button className="btn ghost sm wide" type="button" aria-expanded={adjust} aria-controls="shadowAdjust" onClick={() => setAdjust(!adjust)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2.5 5h7M12.5 5h1M2.5 11h1M6.5 11h7" /><circle cx="11" cy="5" r="1.6" /><circle cx="5" cy="11" r="1.6" />
          </svg>
          Adjust shadow
        </button>
        <div className="stack" id="shadowAdjust" hidden={!adjust}>
          <RangeRow id="sBlur" label="Blur" min={0} max={200} value={f.blur} onInput={(v) => editShadow({ blur: v })} />
          <RangeRow id="sY" label="Drop" min={-60} max={160} value={f.y} onInput={(v) => editShadow({ y: v })} />
          <RangeRow id="sX" label="Shift" min={-80} max={80} value={f.x} onInput={(v) => editShadow({ x: v })} />
          <ColorRow id="sColor" label="Color" value={f.color} onInput={(v) => editShadow({ color: v })} />
        </div>
      </section>
    </>
  );
}
