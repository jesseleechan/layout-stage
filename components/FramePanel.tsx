'use client';
import { useShallow } from 'zustand/react/shallow';
import { SHADOW_PRESETS, type ShadowPreset } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { Chips, ColorRow, RangeRow, type Option } from './controls';

const SHADOW_OPTIONS: Option<Exclude<ShadowPreset, 'custom'>>[] = SHADOW_PRESETS.map((p) => ({ value: p.id, label: p.label }));

export default function FramePanel() {
  const f = useEditor(
    useShallow((s) => {
      const { radius, borderW, borderC, shadow } = s.doc.frame;
      return { radius, borderW, borderC, preset: shadow.preset, blur: shadow.blur, x: shadow.x, y: shadow.y, opacity: shadow.opacity, color: shadow.color };
    }),
  );
  const { editFrame, editShadow, setShadowPreset } = useEditor.getState();

  return (
    <section className="group">
      <div className="group-head">
        <h2>Frame</h2>
        <span className="note">All layouts</span>
      </div>
      <RangeRow id="fRadius" label="Corners" min={0} max={80} value={f.radius} onInput={(v) => editFrame({ radius: v })} />
      <RangeRow id="fBorderW" label="Border" min={0} max={16} value={f.borderW} onInput={(v) => editFrame({ borderW: v })} />
      <ColorRow id="fBorderC" label="Border color" value={f.borderC} onInput={(v) => editFrame({ borderC: v })} />
      <div className="sub">Shadow</div>
      <Chips
        label="Shadow style"
        options={SHADOW_OPTIONS}
        value={f.preset === 'custom' ? null : f.preset}
        onPick={setShadowPreset}
      />
      <RangeRow id="sBlur" label="Blur" min={0} max={200} value={f.blur} onInput={(v) => editShadow({ blur: v })} />
      <RangeRow id="sY" label="Drop" min={-60} max={160} value={f.y} onInput={(v) => editShadow({ y: v })} />
      <RangeRow id="sX" label="Shift" min={-80} max={80} value={f.x} onInput={(v) => editShadow({ x: v })} />
      <RangeRow id="sOp" label="Strength" min={0} max={1} step={0.01} value={f.opacity} format="pct" onInput={(v) => editShadow({ opacity: v })} />
      <ColorRow id="sColor" label="Shadow color" value={f.color} onInput={(v) => editShadow({ color: v })} />
    </section>
  );
}
