'use client';
import { useShallow } from 'zustand/react/shallow';
import { CROPS, type CropId } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { scrollAxis } from '@/lib/render/units';
import { Chips, RangeRow, type Option } from './controls';

const CROP_OPTIONS: Option<CropId>[] = CROPS.map((c) => ({ value: c.id, label: c.label }));

export default function SelectedPanel() {
  const v = useEditor(
    useShallow((st) => {
      const i = st.ui.selected;
      const has = i != null && i < st.doc.count;
      const s = st.doc.slots[has ? i : 0];
      return {
        has, i: has ? i : 0, W: st.doc.W, H: st.doc.H,
        name: s.name, sample: s.source.kind === 'sample', crop: s.crop, w: s.w,
        axis: has ? scrollAxis(s) : null, fx: s.fx, fy: s.fy,
      };
    }),
  );
  const { has, i, axis } = v;
  const scroll = axis === 'y' ? v.fy : v.fx;

  return (
    <section className="group" id="selGroup">
      <div className="group-head">
        <h2 id="selTitle">{has ? `Layout ${i + 1}` : 'Selected layout'}</h2>
        <span className="note" id="selNote">{has ? (v.sample ? 'Sample image' : v.name) : ''}</span>
      </div>
      {!has ? (
        <p className="fine" id="selEmpty">Click a layout on the canvas to crop, resize or align it.</p>
      ) : (
        <div className="stack" id="selBody">
          <div className="sub">Crop</div>
          <Chips id="cropChips" label="Crop" options={CROP_OPTIONS} value={v.crop} onPick={(c) => useEditor.getState().setCrop(i, c)} />
          {axis && (
            <RangeRow
              id="scroll"
              label={axis === 'y' ? 'Scroll' : 'Pan'}
              min={0}
              max={100}
              value={scroll}
              out={Math.round(scroll) + '%'}
              onInput={(n) => useEditor.getState().setScroll(i, n)}
            />
          )}
          <RangeRow
            id="shotW"
            label="Width"
            min={Math.round(Math.min(v.W, v.H) * 0.1)}
            max={Math.round(Math.max(v.W, v.H) * 1.2)}
            value={Math.round(v.w)}
            onInput={(n) => useEditor.getState().setWidth(i, n)}
          />
          <div className="btn-grid">
            <button className="btn sm" type="button" onClick={() => useEditor.getState().centerSelected('h')}>Center H</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().centerSelected('v')}>Center V</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().layer(1)}>Bring forward</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().layer(-1)}>Send back</button>
          </div>
        </div>
      )}
    </section>
  );
}
