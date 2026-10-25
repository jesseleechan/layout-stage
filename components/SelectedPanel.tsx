'use client';
import { useShallow } from 'zustand/react/shallow';
import { CROPS, type CropId } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { rectOf, scrollAxis, zoomOf } from '@/lib/render/units';
import { heightRange } from '@/lib/crop';
import { Chips, RangeRow, type Option } from './controls';
import MiniMap from './MiniMap';
import AlignTools from './AlignTools';

const CROP_OPTIONS: Option<CropId>[] = CROPS.map((c) => ({ value: c.id, label: c.label }));

export default function SelectedPanel() {
  const v = useEditor(
    useShallow((st) => {
      const i = st.ui.selected;
      const has = i != null && i < st.doc.count;
      const s = st.doc.slots[has ? i : 0];
      const hr = heightRange(s);
      return {
        has, i: has ? i : 0, W: st.doc.W, H: st.doc.H,
        name: s.name, sample: s.source.kind === 'sample', crop: s.crop, w: s.w,
        h: rectOf(s).h, hMin: Math.ceil(hr.min), hMax: Math.floor(hr.max),
        axis: has ? scrollAxis(s) : null, fx: s.fx, fy: s.fy, zoom: zoomOf(s), count: st.doc.count,
      };
    }),
  );
  const { has, i, axis } = v;
  const scroll = axis === 'y' ? v.fy : v.fx;
  // Zoomed in, the window moves both ways: the other axis gets its own slider.
  const other = v.zoom > 1 && axis ? (axis === 'y' ? 'x' : 'y') : null;
  const otherValue = other === 'x' ? v.fx : v.fy;

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
          <div className="sub">Crop{v.crop === 'custom' && <span className="sub-note" id="cropNote"> · free height</span>}</div>
          <Chips id="cropChips" label="Crop" options={CROP_OPTIONS} value={v.crop} onPick={(c) => useEditor.getState().setCrop(i, c)} />
          {axis && <MiniMap i={i} axis={axis} />}
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
          {other && (
            <RangeRow
              id="scroll2"
              label={other === 'y' ? 'Scroll' : 'Pan'}
              min={0}
              max={100}
              value={otherValue}
              out={Math.round(otherValue) + '%'}
              onInput={(n) => useEditor.getState().setWindow(i, other === 'x' ? { fx: n } : { fy: n })}
            />
          )}
          <RangeRow
            id="shotZoom"
            label="Zoom"
            min={1}
            max={4}
            step={0.1}
            value={Math.round(v.zoom * 10) / 10}
            out={`${v.zoom.toFixed(1)}×`}
            onInput={(n) => useEditor.getState().setZoom(i, n)}
          />
          <RangeRow
            id="shotW"
            label="Width"
            min={Math.round(Math.min(v.W, v.H) * 0.1)}
            max={Math.round(Math.max(v.W, v.H) * 1.2)}
            value={Math.round(v.w)}
            onInput={(n) => useEditor.getState().setWidth(i, n)}
          />
          <RangeRow
            id="shotH"
            label="Height"
            min={v.hMin}
            max={v.hMax}
            value={Math.round(v.h)}
            onInput={(n) => useEditor.getState().setHeight(i, n)}
          />
          <button
            className="btn sm wide" id="calloutBtn" type="button" disabled={v.count >= 3}
            title={v.count >= 3 ? 'A callout is a layout of its own: remove one first' : 'A magnified card of what this layout shows, on top'}
            onClick={() => useEditor.getState().addCallout(i)}
          >
            Add zoom callout
          </button>
          <div className="btn-grid">
            <button className="btn sm" type="button" onClick={() => useEditor.getState().centerSelected('h')}>Center H</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().centerSelected('v')}>Center V</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().layer(1)}>Bring forward</button>
            <button className="btn sm" type="button" onClick={() => useEditor.getState().layer(-1)}>Send back</button>
          </div>
          <AlignTools i={i} />
        </div>
      )}
    </section>
  );
}
