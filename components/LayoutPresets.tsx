'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  applyArrangement, arrange, ARRANGEMENT_NAMES, arrangementOf, canContinuePage, canvasKind, pageMeasure, presetArrangements, presetOf, showFirstPage,
} from '@/lib/arrange';
import { clone, type Arrangement, type Composition } from '@/lib/model';
import { renderComposition } from '@/lib/render/export';
import { useEditor } from '@/lib/store';
import { Seg, type Option } from './controls';

/* How many layouts, and the layout presets: live thumbnails of the canvas in each arrangement, drawn
   with the shared renderer from the screenshots, frame and background on the canvas now (as Shots
   does). The one in use shows the canvas as it is; picking it again starts it over. */

/** A 30 × 18 layout icon; shapes that run past the box run off the canvas. */
const LayoutIcon = ({ children }: { children: ReactNode }) => (
  <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {children}
  </svg>
);

const COUNT_SHAPES: Record<1 | 2 | 3, ReactNode> = {
  1: <rect x="11.5" y="2.5" width="7" height="13" rx="1.6" fill="currentColor" />,
  2: (
    <>
      <rect x="7" y="2.5" width="7" height="13" rx="1.6" fill="currentColor" />
      <rect x="16" y="2.5" width="7" height="13" rx="1.6" fill="currentColor" />
    </>
  ),
  3: (
    <>
      <rect x="3.5" y="2.5" width="6.5" height="13" rx="1.6" fill="currentColor" />
      <rect x="11.75" y="2.5" width="6.5" height="13" rx="1.6" fill="currentColor" />
      <rect x="20" y="2.5" width="6.5" height="13" rx="1.6" fill="currentColor" />
    </>
  ),
};

const COUNT_OPTIONS: Option<1 | 2 | 3>[] = ([1, 2, 3] as const).map((n) => ({
  value: n,
  label: <LayoutIcon>{COUNT_SHAPES[n]}</LayoutIcon>,
  'aria-label': n === 1 ? '1 layout' : `${n} layouts`,
}));

type PresetKey = Arrangement | 'continue';
interface Preset {
  key: PresetKey;
  name: string;
  /** The canvas as this preset would make it. */
  doc: (d: Composition) => Composition;
}

/** The presets for the canvas now (presetArrangements), and, for two columns showing two pages,
 *  one long page continued across both. */
function presetsFor(doc: Composition): Preset[] {
  const n = doc.count;
  const now = presetOf(arrangementOf(doc), n);
  const as = (a: Arrangement) => (d: Composition) => {
    const c = clone(d);
    if (a !== now) applyArrangement(c, a, pageMeasure());
    return c;
  };
  const list: Preset[] = presetArrangements(n).map((a) => ({ key: a, name: ARRANGEMENT_NAMES[a][n], doc: as(a) }));
  if (n === 2 && now === 'showcase' && doc.slots[1].imageId !== doc.slots[0].imageId && canContinuePage(doc, pageMeasure())) {
    list.splice(1, 0, {
      key: 'continue',
      name: 'One page',
      doc: (d) => {
        const c = clone(d);
        showFirstPage(c, 1);
        arrange(c, 2, pageMeasure());
        return c;
      },
    });
  }
  return list;
}

/** Thumbnail width in CSS px, two to a row (one for landscape canvases); drawn at twice that. */
const thumbWidth = (W: number, H: number) => (canvasKind(W, H) === 'land' ? 212 : 104);
/** Redraw the thumbnails this long after the canvas stops changing. */
const THUMB_IDLE_MS = 220;

function useThumbnails(doc: Composition, presets: Preset[]): Partial<Record<PresetKey, string>> {
  const [urls, setUrls] = useState<Partial<Record<PresetKey, string>>>({});
  const seq = useRef(0);
  const keys = presets.map((p) => p.key).join();
  useEffect(() => {
    const run = ++seq.current;
    const t = setTimeout(async () => {
      const m = (thumbWidth(doc.W, doc.H) * 2) / doc.W;
      const next: Partial<Record<PresetKey, string>> = {};
      for (const p of presets) {
        try {
          const c = await renderComposition(p.doc(doc), m);
          if (run !== seq.current) return;
          next[p.key] = c.toDataURL('image/jpeg', 0.86);
        } catch {
          /* an image still loading: drawn on the next change */
        }
      }
      if (run === seq.current) setUrls(next);
    }, THUMB_IDLE_MS);
    return () => clearTimeout(t);
    // presets is rebuilt from doc each render; keys says which presets there are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, keys]);
  return urls;
}

export default function LayoutPresets() {
  const doc = useEditor((s) => s.doc);
  const hydrated = useEditor((s) => s.hydrated);
  const { setCount, setArrangement, rearrange, continuePage } = useEditor.getState();
  const presets = presetsFor(doc);
  const urls = useThumbnails(doc, hydrated ? presets : []);
  const now = presetOf(arrangementOf(doc), doc.count);
  const wide = canvasKind(doc.W, doc.H) === 'land';

  const pick = (k: PresetKey) => {
    if (k === 'continue') continuePage(1);
    else if (k === now) rearrange();
    else setArrangement(k);
  };

  return (
    <>
      <section className="group">
        <Seg className="count" label="Number of layouts" options={COUNT_OPTIONS} value={doc.count} onPick={setCount} />
      </section>
      <section className="group">
        <div className="group-head">
          <h2>Layout presets</h2>
        </div>
        <div className="presets" role="group" aria-label="Arrangement" style={{ '--cols': wide ? 1 : 2, '--ar': `${doc.W} / ${doc.H}` } as CSSProperties}>
          {presets.map((p) => (
            <button
              key={p.key} className="tile preset" type="button" aria-label={p.name} aria-pressed={p.key === now}
              title={p.key === now ? `${p.name}: pick again to start the layouts over` : p.name} onClick={() => pick(p.key)}
            >
              <span className="tile-face" aria-hidden="true">
                {urls[p.key] ? <img alt="" src={urls[p.key]} /> : null}
              </span>
              <span className="tile-cap" aria-hidden="true">{p.name}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
