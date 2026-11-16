'use client';
import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  anyOverlay, defaultOverlays, OVERLAY_FONT_IDS, OVERLAY_FONTS,
  type BadgeShape, type HeadlineFill, type HeadlinePlace, type OverlayAlign, type OverlayCorner, type OverlayFontId, type WatermarkPlace,
} from '@/lib/overlays';
import { useEditor } from '@/lib/store';
import { ColorRow, RangeRow, Seg, type Option } from './controls';

const PLACES: Option<HeadlinePlace>[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];
const ALIGNS: Option<OverlayAlign>[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
const FILLS: Option<HeadlineFill>[] = [
  { value: 'none', label: 'None' },
  { value: 'pill', label: 'Pill' },
  { value: 'band', label: 'Band' },
];
const CORNERS: { value: OverlayCorner; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'br', label: 'Bottom right' },
];
const WM_PLACES: { value: WatermarkPlace; label: string }[] = [
  ...CORNERS,
  { value: 'center', label: 'Center' },
];
const BADGE_SHAPES: Option<BadgeShape>[] = [
  { value: 'pill', label: 'Pill' },
  { value: 'circle', label: 'Circle' },
];
const WM_KINDS: Option<'text' | 'logo'>[] = [
  { value: 'text', label: 'Text' },
  { value: 'logo', label: 'Logo' },
];

/* Text & logo ("Brand") controls in the Canvas tab: headline, badge, and watermark. */
export default function BrandPanel() {
  const { overlays, hasAny } = useEditor(
    useShallow((s) => ({
      overlays: s.doc.overlays ?? defaultOverlays(),
      hasAny: anyOverlay(s.doc),
    })),
  );
  const { setOverlay, editOverlay, setWatermarkLogo, hideOverlays, commit } = useEditor.getState();
  const logoRef = useRef<HTMLInputElement>(null);
  const { headline: h, badge: b, watermark: w } = overlays;

  return (
    <section className="group" aria-label="Text and logo">
      <div className="group-head">
        <h2>Text &amp; logo</h2>
        {hasAny && (
          <button className="btn xs" id="hideOverlaysBtn" type="button" onClick={hideOverlays}>
            Remove all
          </button>
        )}
      </div>

      <div className="brand-block">
        <label className="brand-toggle">
          <input type="checkbox" checked={h.enabled} onChange={(e) => setOverlay('headline', { enabled: e.target.checked })} />
          <span>Headline</span>
        </label>
        {h.enabled && (
          <div className="stack">
            <textarea
              className="input brand-textarea"
              rows={2}
              aria-label="Headline text"
              value={h.text}
              onChange={(e) => editOverlay('headline', { text: e.target.value })}
              onBlur={commit}
            />
            <div className="row">
              <label htmlFor="hlFont">Font</label>
              <select
                id="hlFont"
                className="select"
                value={h.font}
                onChange={(e) => setOverlay('headline', { font: e.target.value as OverlayFontId })}
              >
                {OVERLAY_FONT_IDS.map((id) => (
                  <option key={id} value={id}>{OVERLAY_FONTS[id].label}</option>
                ))}
              </select>
            </div>
            <Seg label="Place" options={PLACES} value={h.place} onPick={(place) => setOverlay('headline', { place })} />
            <Seg label="Align" options={ALIGNS} value={h.align} onPick={(align) => setOverlay('headline', { align })} />
            <Seg label="Backdrop" options={FILLS} value={h.fill} onPick={(fill) => setOverlay('headline', { fill })} />
            <RangeRow id="hlSize" label="Size" value={h.size} min={24} max={120} onInput={(size) => editOverlay('headline', { size })} />
            <ColorRow id="hlColor" label="Color" value={h.color} onInput={(color) => editOverlay('headline', { color })} />
            {h.fill !== 'none' && (
              <ColorRow id="hlFill" label="Backdrop color" value={h.fillColor} onInput={(fillColor) => editOverlay('headline', { fillColor })} />
            )}
          </div>
        )}
      </div>

      <div className="brand-block">
        <label className="brand-toggle">
          <input type="checkbox" checked={b.enabled} onChange={(e) => setOverlay('badge', { enabled: e.target.checked })} />
          <span>Badge</span>
        </label>
        {b.enabled && (
          <div className="stack">
            <input
              className="input"
              type="text"
              aria-label="Badge text"
              value={b.text}
              onChange={(e) => editOverlay('badge', { text: e.target.value })}
              onBlur={commit}
            />
            <Seg label="Shape" options={BADGE_SHAPES} value={b.shape} onPick={(shape) => setOverlay('badge', { shape })} />
            <div className="row">
              <label htmlFor="badgeCorner">Corner</label>
              <select
                id="badgeCorner"
                className="select"
                value={b.corner}
                onChange={(e) => setOverlay('badge', { corner: e.target.value as OverlayCorner })}
              >
                {CORNERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <ColorRow id="badgeColor" label="Text" value={b.color} onInput={(color) => editOverlay('badge', { color })} />
            <ColorRow id="badgeFill" label="Fill" value={b.fillColor} onInput={(fillColor) => editOverlay('badge', { fillColor })} />
          </div>
        )}
      </div>

      <div className="brand-block">
        <label className="brand-toggle">
          <input type="checkbox" checked={w.enabled} onChange={(e) => setOverlay('watermark', { enabled: e.target.checked })} />
          <span>Watermark</span>
        </label>
        {w.enabled && (
          <div className="stack">
            <Seg label="Kind" options={WM_KINDS} value={w.kind} onPick={(kind) => setOverlay('watermark', { kind })} />
            {w.kind === 'text' ? (
              <input
                className="input"
                type="text"
                aria-label="Watermark text"
                value={w.text}
                onChange={(e) => editOverlay('watermark', { text: e.target.value })}
                onBlur={commit}
              />
            ) : (
              <div className="row">
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void setWatermarkLogo(f);
                  }}
                />
                <button className="btn sm wide" type="button" onClick={() => logoRef.current?.click()}>
                  {w.imageName ? `Logo: ${w.imageName}` : 'Upload logo…'}
                </button>
              </div>
            )}
            <div className="row">
              <label htmlFor="wmPlace">Corner</label>
              <select
                id="wmPlace"
                className="select"
                value={w.place}
                onChange={(e) => setOverlay('watermark', { place: e.target.value as WatermarkPlace })}
              >
                {WM_PLACES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <RangeRow
              id="wmOpacity"
              label="Opacity"
              value={Math.round(w.opacity * 100)}
              min={10}
              max={100}
              format="pct"
              onInput={(v) => editOverlay('watermark', { opacity: v / 100 })}
            />
          </div>
        )}
      </div>
    </section>
  );
}
