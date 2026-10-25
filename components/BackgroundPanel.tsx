'use client';
import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GRADS, MESHES, SOLIDS, type Background, type BackgroundType } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { useThumbUrl } from '@/lib/images';
import { ColorInput, ColorRow, RangeRow, Seg, cols, type Option } from './controls';
import { getMeshThumbs } from './thumbs';

const TYPE_OPTIONS: Option<BackgroundType>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'image', label: 'Image' },
];
const MESH_LABELS: [string, string][] = [
  ['Base', 'Mesh base color'],
  ['Glow 1', 'Mesh glow 1'],
  ['Glow 2', 'Mesh glow 2'],
  ['Glow 3', 'Mesh glow 3'],
];
const lc = (s: string) => String(s).toLowerCase();

export default function BackgroundPanel() {
  const b = useEditor(
    useShallow((s) => {
      const bg = s.doc.background;
      const sel = s.ui.selected;
      return {
        type: bg.type, solid: bg.solid, ga: bg.grad.a, gb: bg.grad.b, angle: bg.grad.angle,
        m0: bg.mesh[0], m1: bg.mesh[1], m2: bg.mesh[2], m3: bg.mesh[3],
        imageId: bg.imageId, imageName: bg.imageName, blur: bg.blur, dim: bg.dim, grain: bg.grain,
        blurOf: (sel != null && sel < s.doc.count ? sel : 0) + 1,
      };
    }),
  );
  const { editBackground, setBackgroundType, pickSolid, pickGradient, pickMesh, shuffleMesh, backgroundFromLayout } = useEditor.getState();
  const meshThumbs = useMemo(() => getMeshThumbs(), []);
  const imgUrl = useThumbUrl(b.imageId);
  const fileRef = useRef<HTMLInputElement>(null);
  const mesh = [b.m0, b.m1, b.m2, b.m3];
  const meshKey = lc(mesh.join());

  const setMesh = (k: number, v: string) => {
    const m = [...mesh] as Background['mesh'];
    m[k] = v;
    editBackground({ mesh: m });
  };

  return (
    <section className="group">
      <div className="group-head">
        <h2>Background</h2>
      </div>
      <Seg label="Background type" options={TYPE_OPTIONS} value={b.type} onPick={setBackgroundType} />
      <MatchSiteColors layout={b.blurOf} />

      {b.type === 'solid' && (
        <div className="stack" data-pane="solid">
          <div className="swatches" id="solidSw" style={cols(6)}>
            {SOLIDS.map((c) => (
              <button
                key={c}
                className="sw"
                type="button"
                style={{ background: c }}
                aria-label={`Solid ${c}`}
                aria-pressed={lc(c) === lc(b.solid)}
                onClick={() => pickSolid(c)}
              />
            ))}
          </div>
          <ColorRow id="bgSolid" label="Color" value={b.solid} onInput={(v) => editBackground({ solid: v })} />
        </div>
      )}

      {b.type === 'gradient' && (
        <div className="stack" data-pane="gradient">
          <div className="swatches" id="gradSw" style={cols(5)}>
            {GRADS.map(([a, c, ang], i) => (
              <button
                key={i}
                className="sw"
                type="button"
                style={{ background: `linear-gradient(${ang}deg, ${a}, ${c})` }}
                aria-label={`Gradient ${i + 1}`}
                aria-pressed={lc(a) === lc(b.ga) && lc(c) === lc(b.gb) && ang === +b.angle}
                onClick={() => pickGradient(i)}
              />
            ))}
          </div>
          <ColorRow id="gA" label="From" value={b.ga} onInput={(v) => editBackground({ grad: { a: v, b: b.gb, angle: b.angle } })} />
          <ColorRow id="gB" label="To" value={b.gb} onInput={(v) => editBackground({ grad: { a: b.ga, b: v, angle: b.angle } })} />
          <RangeRow id="gAngle" label="Angle" min={0} max={360} value={b.angle} format="deg" onInput={(v) => editBackground({ grad: { a: b.ga, b: b.gb, angle: v } })} />
        </div>
      )}

      {b.type === 'mesh' && (
        <div className="stack" data-pane="mesh">
          <div className="swatches" id="meshSw" style={cols(3)}>
            {MESHES.map((m, i) => (
              <button
                key={i}
                className="sw wide"
                type="button"
                style={{ backgroundImage: `url(${meshThumbs[i]})` }}
                aria-label={`Mesh ${i + 1}`}
                aria-pressed={lc(m.join()) === meshKey}
                onClick={() => pickMesh(i)}
              />
            ))}
          </div>
          <div className="mesh-colors">
            {MESH_LABELS.map(([label, aria], k) => (
              <label key={k}>
                <ColorInput aria-label={aria} value={mesh[k]} onInput={(v) => setMesh(k, v)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button className="btn sm wide" id="shuffleBtn" type="button" onClick={shuffleMesh}>
            Shuffle glow positions
          </button>
        </div>
      )}

      {b.type === 'image' && (
        <div className="stack" data-pane="image">
          <div className="bgimg">
            <div className="bgimg-thumb">
              <img id="bgImgThumb" alt="" src={imgUrl ?? undefined} hidden={!b.imageId || !imgUrl} />
            </div>
            <div className="bgimg-text">
              <strong id="bgImgName">{b.imageId ? b.imageName || 'Background image' : 'No image chosen'}</strong>
              <span className="fine">A photo, a texture, or a blurred copy of a layout.</span>
            </div>
          </div>
          <div className="btn-grid">
            <button className="btn sm" id="bgUploadBtn" type="button" onClick={() => fileRef.current?.click()}>
              Upload image
            </button>
            <button className="btn sm" id="bgFromLayoutBtn" type="button" onClick={backgroundFromLayout}>
              Blur layout {b.blurOf}
            </button>
          </div>
          <RangeRow id="bgBlur" label="Blur" min={0} max={120} value={b.blur} onInput={(v) => editBackground({ blur: v })} />
          <RangeRow id="bgDim" label="Darken" min={0} max={0.7} step={0.01} value={b.dim} format="pct" onInput={(v) => editBackground({ dim: v })} />
        </div>
      )}

      <RangeRow id="bgGrain" label="Grain" min={0} max={40} value={b.grain} onInput={(v) => editBackground({ grain: v })} />
      <input
        ref={fileRef}
        type="file"
        id="fileBg"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void useEditor.getState().setBackgroundFile(f);
        }}
      />
    </section>
  );
}

/** "Match site colors": a background from the selected layout's colors (else layout 1). Each click is
 *  one undo step and moves on to the next variant: mesh → gradient → solid → mesh. */
function MatchSiteColors({ layout }: { layout: number }) {
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const run = async () => {
    if (busy.current) return; // the first read of an image can take a moment
    busy.current = true;
    setWorking(true);
    try {
      await useEditor.getState().matchSiteColors();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };
  return (
    <button className="btn sm wide" id="matchSiteBtn" type="button" aria-busy={working} title={`Uses layout ${layout}’s colors`} onClick={() => void run()}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <circle cx="4.5" cy="5" r="2.6" /><circle cx="9.5" cy="5" r="2.6" /><circle cx="7" cy="9.4" r="2.6" />
      </svg>
      Match site colors
    </button>
  );
}
