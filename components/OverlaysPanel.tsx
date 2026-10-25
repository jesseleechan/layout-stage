'use client';
/* Text & logo: the headline, badge and watermark drawn above the layouts (lib/overlays.ts). Each has a
   switch and, when on, its fields. Sliders and colors are live and save a step on release; typing is
   live and saves one step per pause or when the field loses focus. */
import { useEffect, useMemo, useRef, type ChangeEvent, type ReactNode } from 'react';
import { useEditor } from '@/lib/store';
import {
  BADGE_MAX_CHARS, BADGE_SIZE, HEADLINE_MAX_CHARS, HEADLINE_OFFSET, HEADLINE_SIZE, INSET_MAX, OVERLAY_FONT_IDS, OVERLAY_FONTS,
  WATERMARK_LOGO_SIZE, WATERMARK_MAX_CHARS, WATERMARK_TEXT_SIZE, WEIGHT_LABELS, defaultOverlays, resolveFace,
  type Badge, type BadgeShape, type Headline, type HeadlineFill, type HeadlinePlace, type OverlayAlign, type OverlayCorner,
  type OverlayFontId, type OverlayKey, type Overlays, type Watermark, type WatermarkPlace,
} from '@/lib/overlays';
import { loadAllOverlayFonts } from '@/lib/render/overlay-fonts';
import { useImageUrl } from '@/lib/images';
import { ColorRow, RangeRow, Seg, type Option } from './controls';
import './overlays.css';

/** Typing saves one undo step after this much idle. */
const TYPE_IDLE_MS = 600;

const st = () => useEditor.getState();
const edit = <K extends OverlayKey>(key: K, patch: Partial<Overlays[K]>) => st().editOverlay(key, patch);
const set = <K extends OverlayKey>(key: K, patch: Partial<Overlays[K]>) => st().setOverlay(key, patch);

/** Live typing with one undo step per pause, and one when the field loses focus. */
function useTypingCommit() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current) { clearTimeout(timer.current); st().commit(); }
    },
    [],
  );
  return {
    typed() {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = undefined; st().commit(); }, TYPE_IDLE_MS);
    },
    flush() {
      clearTimeout(timer.current);
      timer.current = undefined;
      st().commit();
    },
  };
}

function Head({ id, title, on, onToggle }: { id: string; title: string; on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className="ov-head">
      <label className="sub" htmlFor={id}>{title}</label>
      <button type="button" role="switch" className="switch" id={id} aria-checked={on} onClick={() => onToggle(!on)} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ov-field">
      <span className="lbl" aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

/** Font chips, each name set in its own face. */
function FontPicker({ label, value, onPick }: { label: string; value: OverlayFontId; onPick: (f: OverlayFontId) => void }) {
  return (
    <div className="ov-fonts" role="group" aria-label={label}>
      {OVERLAY_FONT_IDS.map((id) => {
        const f = OVERLAY_FONTS[id];
        return (
          <button
            key={id} type="button" className="chip" aria-pressed={id === value} onClick={() => onPick(id)}
            style={{ fontFamily: `"${f.family}", ${f.fallback}`, fontWeight: resolveFace(id, 600).weight }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small canvas with a mark in the corner (or center) it stands for. */
function PlaceIcon({ p }: { p: WatermarkPlace }) {
  const x = p === 'tl' || p === 'bl' ? 3.5 : p === 'center' ? 6.5 : 9.5;
  const y = p === 'tl' || p === 'tr' ? 3.5 : p === 'center' ? 5 : 6.5;
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
      <rect x=".75" y=".75" width="16.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x={x} y={y} width="5" height="4" rx="1" fill="currentColor" />
    </svg>
  );
}
const PLACE_NAMES: Record<WatermarkPlace, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right', center: 'Center' };
const placeOptions = <T extends WatermarkPlace>(ps: T[]): Option<T>[] => ps.map((p) => ({ value: p, label: <PlaceIcon p={p} />, 'aria-label': PLACE_NAMES[p] }));
const CORNER_OPTIONS = placeOptions<OverlayCorner>(['tl', 'tr', 'bl', 'br']);
const WATERMARK_PLACES = placeOptions<WatermarkPlace>(['tl', 'tr', 'center', 'bl', 'br']);

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
const SHAPES: Option<BadgeShape>[] = [
  { value: 'pill', label: 'Pill' },
  { value: 'circle', label: 'Round' },
];
const KINDS: Option<Watermark['kind']>[] = [
  { value: 'logo', label: 'Logo' },
  { value: 'text', label: 'Text' },
];

function HeadlineFields({ h }: { h: Headline }) {
  const typing = useTypingCommit();
  const font = OVERLAY_FONTS[h.font];
  const face = resolveFace(h.font, h.weight, h.italic);
  const weights: Option<number>[] = font.weights.map((w) => ({ value: w, label: String(w), 'aria-label': WEIGHT_LABELS[w] ?? String(w) }));
  return (
    <div className="stack">
      <textarea
        className="ov-input" id="ovHeadText" rows={2} aria-label="Headline text" placeholder="Your headline" maxLength={HEADLINE_MAX_CHARS} value={h.text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { edit('headline', { text: e.target.value }); typing.typed(); }}
        onBlur={typing.flush}
        onKeyDown={(e) => {
          // One or two lines: a second break isn't allowed.
          if (e.key === 'Enter' && e.currentTarget.value.includes('\n')) e.preventDefault();
        }}
      />
      <FontPicker label="Headline font" value={h.font} onPick={(f) => set('headline', { font: f })} />
      {(weights.length > 1 || font.italics.length > 0) && (
        <Field label="Weight">
          <div className="ov-pair">
            <Seg label="Headline weight" options={weights} value={face.weight} onPick={(w) => set('headline', { weight: w })} />
            {font.italics.length > 0 && (
              <button type="button" className="btn sm" aria-pressed={face.style === 'italic'} onClick={() => set('headline', { italic: face.style !== 'italic' })}>
                Italic
              </button>
            )}
          </div>
        </Field>
      )}
      <RangeRow id="ovHeadSize" label="Size" min={HEADLINE_SIZE.min} max={HEADLINE_SIZE.max} value={h.size} onInput={(v) => edit('headline', { size: v })} />
      <ColorRow id="ovHeadColor" label="Color" value={h.color} onInput={(v) => edit('headline', { color: v })} />
      <Field label="Place">
        <Seg label="Headline place" options={PLACES} value={h.place} onPick={(v) => set('headline', { place: v, dy: 0 })} />
      </Field>
      <Field label="Align">
        <Seg label="Headline alignment" options={ALIGNS} value={h.align} onPick={(v) => set('headline', { align: v, dx: 0 })} />
      </Field>
      <RangeRow id="ovHeadDx" label="Move X" min={-HEADLINE_OFFSET} max={HEADLINE_OFFSET} value={h.dx} onInput={(v) => edit('headline', { dx: v })} />
      <RangeRow id="ovHeadDy" label="Move Y" min={-HEADLINE_OFFSET} max={HEADLINE_OFFSET} value={h.dy} onInput={(v) => edit('headline', { dy: v })} />
      <Field label="Fill">
        <Seg label="Headline fill" options={FILLS} value={h.fill} onPick={(v) => set('headline', { fill: v })} />
      </Field>
      {h.fill !== 'none' && (
        <>
          <ColorRow id="ovHeadFill" label="Fill color" value={h.fillColor} onInput={(v) => edit('headline', { fillColor: v })} />
          <RangeRow id="ovHeadFillOp" label="Fill opacity" min={0} max={1} step={0.01} value={h.fillOpacity} format="pct" onInput={(v) => edit('headline', { fillOpacity: v })} />
        </>
      )}
      <p className="fine">Stays inside the safe area; long lines wrap, then shrink to fit.</p>
    </div>
  );
}

function BadgeFields({ b }: { b: Badge }) {
  const typing = useTypingCommit();
  return (
    <div className="stack">
      <input
        className="ov-input" id="ovBadgeText" type="text" aria-label="Badge text" placeholder="Template" maxLength={BADGE_MAX_CHARS} value={b.text}
        onChange={(e) => { edit('badge', { text: e.target.value }); typing.typed(); }}
        onBlur={typing.flush}
      />
      <FontPicker label="Badge font" value={b.font} onPick={(f) => set('badge', { font: f })} />
      <Field label="Shape">
        <Seg label="Badge shape" options={SHAPES} value={b.shape} onPick={(v) => set('badge', { shape: v })} />
      </Field>
      <Field label="Corner">
        <Seg label="Badge corner" className="ov-corners" options={CORNER_OPTIONS} value={b.corner} onPick={(v) => set('badge', { corner: v })} />
      </Field>
      <RangeRow id="ovBadgeSize" label="Size" min={BADGE_SIZE.min} max={BADGE_SIZE.max} value={b.size} onInput={(v) => edit('badge', { size: v })} />
      <RangeRow id="ovBadgeInset" label="Margin" min={0} max={INSET_MAX} value={b.inset} onInput={(v) => edit('badge', { inset: v })} />
      <ColorRow id="ovBadgeColor" label="Text color" value={b.color} onInput={(v) => edit('badge', { color: v })} />
      <ColorRow id="ovBadgeFill" label="Fill color" value={b.fillColor} onInput={(v) => edit('badge', { fillColor: v })} />
    </div>
  );
}

function WatermarkFields({ w }: { w: Watermark }) {
  const typing = useTypingCommit();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoUrl = useImageUrl(w.imageId);
  return (
    <div className="stack">
      <Field label="Show">
        <Seg label="Watermark kind" options={KINDS} value={w.kind} onPick={(v) => set('watermark', { kind: v })} />
      </Field>
      {w.kind === 'logo' ? (
        <>
          <div className="ov-logo">
            <div className="ov-logo-thumb">
              <img id="ovLogoThumb" alt="" src={logoUrl ?? undefined} hidden={!w.imageId || !logoUrl} />
            </div>
            <div className="ov-logo-text">
              <strong id="ovLogoName">{w.imageId ? w.imageName || 'Logo' : 'No logo yet'}</strong>
              <span className="fine">A PNG with a transparent background works best.</span>
            </div>
          </div>
          <button className="btn sm wide" id="ovLogoBtn" type="button" onClick={() => fileRef.current?.click()}>
            {w.imageId ? 'Replace logo' : 'Upload logo'}
          </button>
          <input
            ref={fileRef} type="file" id="ovLogoFile" accept="image/*" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void st().setWatermarkLogo(f);
            }}
          />
          <RangeRow id="ovWmSize" label="Size" min={WATERMARK_LOGO_SIZE.min} max={WATERMARK_LOGO_SIZE.max} value={w.size} onInput={(v) => edit('watermark', { size: v })} />
        </>
      ) : (
        <>
          <input
            className="ov-input" id="ovWmText" type="text" aria-label="Watermark text" placeholder="yourstudio.com" maxLength={WATERMARK_MAX_CHARS} value={w.text}
            onChange={(e) => { edit('watermark', { text: e.target.value }); typing.typed(); }}
            onBlur={typing.flush}
          />
          <FontPicker label="Watermark font" value={w.font} onPick={(f) => set('watermark', { font: f })} />
          <RangeRow id="ovWmTextSize" label="Size" min={WATERMARK_TEXT_SIZE.min} max={WATERMARK_TEXT_SIZE.max} value={w.textSize} onInput={(v) => edit('watermark', { textSize: v })} />
          <ColorRow id="ovWmColor" label="Color" value={w.color} onInput={(v) => edit('watermark', { color: v })} />
        </>
      )}
      <Field label="Position">
        <Seg label="Watermark position" className="ov-corners" options={WATERMARK_PLACES} value={w.place} onPick={(v) => set('watermark', { place: v })} />
      </Field>
      <RangeRow id="ovWmInset" label="Margin" min={0} max={INSET_MAX} value={w.inset} onInput={(v) => edit('watermark', { inset: v })} />
      <RangeRow id="ovWmOpacity" label="Opacity" min={0} max={1} step={0.01} value={w.opacity} format="pct" onInput={(v) => edit('watermark', { opacity: v })} />
    </div>
  );
}

export default function OverlaysPanel() {
  // As a string, so the panel only re-renders when an overlay changes (the store clones `doc` on every edit).
  const key = useEditor((s) => JSON.stringify(s.doc.overlays ?? null));
  const o = useMemo<Overlays>(() => (JSON.parse(key) as Overlays | null) ?? defaultOverlays(), [key]);
  const anyOn = o.headline.enabled || o.badge.enabled || o.watermark.enabled;
  useEffect(() => {
    if (anyOn) void loadAllOverlayFonts();
  }, [anyOn]);

  return (
    <section className="group" id="overlaysGroup">
      <div className="group-head">
        <h2>Text &amp; logo</h2>
        <span className="note">Above the layouts</span>
      </div>
      <div className="ov-item">
        <Head id="ovHeadOn" title="Headline" on={o.headline.enabled} onToggle={(on) => set('headline', { enabled: on })} />
        {o.headline.enabled && <HeadlineFields h={o.headline} />}
      </div>
      <div className="ov-item">
        <Head id="ovBadgeOn" title="Badge" on={o.badge.enabled} onToggle={(on) => set('badge', { enabled: on })} />
        {o.badge.enabled && <BadgeFields b={o.badge} />}
      </div>
      <div className="ov-item">
        <Head id="ovWmOn" title="Watermark" on={o.watermark.enabled} onToggle={(on) => set('watermark', { enabled: on })} />
        {o.watermark.enabled && <WatermarkFields w={o.watermark} />}
      </div>
    </section>
  );
}
