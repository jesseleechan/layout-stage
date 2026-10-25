'use client';
/* Scrolling video: the export sheet's video mode. Pick the layout that scrolls, the length, the pause
   at the top and bottom, the motion and the size; then it renders with progress and Cancel, and shows
   the MP4 to play and save. The frames come from lib/video/render.ts, which draws them with the same
   renderers as the still export. Closing the sheet cancels a render in progress. */
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/store';
import { clone } from '@/lib/model';
import { scrollAxis } from '@/lib/render/units';
import { hasVideoEncoder, renderScrollVideo, VideoUnsupportedError, type VideoResult } from '@/lib/video/render';
import {
  canScroll, defaultScrollSlot, frameCount, VIDEO_HOLD, VIDEO_LONG_DEFAULT, VIDEO_SECONDS, VIDEO_SIZES, videoSize,
  type VideoEasing, type VideoLong,
} from '@/lib/video/timing';
import { Seg, type Option } from './controls';
import PinTextSection from './PinText';
import './video.css';

type Phase = 'setup' | 'rendering' | 'done';

const EASINGS: Option<VideoEasing>[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'linear', label: 'Steady' },
  { value: 'steps', label: 'Screen by screen' },
];

/** What the sheet was last set to, so it reopens as it was left (for this visit). */
let remembered = { seconds: VIDEO_SECONDS.default, hold: VIDEO_HOLD.default, easing: 'smooth' as VideoEasing, long: VIDEO_LONG_DEFAULT as VideoLong };

const fmtBytes = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const fmtSeconds = (s: number) => `${Number.isInteger(s) ? s : s.toFixed(1)} s`;

export default function VideoBody({ onClose, notify, onWide }: { onClose: () => void; notify: (msg: string) => void; onWide: (wide: boolean) => void }) {
  // The canvas as the sheet opened (only pin text can change while it is open).
  const [doc] = useState(() => clone(useEditor.getState().doc));
  const [slot, setSlot] = useState<number | null>(() => defaultScrollSlot(doc, useEditor.getState().ui.selected));
  const [seconds, setSeconds] = useState(remembered.seconds);
  const [hold, setHold] = useState(remembered.hold);
  const [easing, setEasing] = useState<VideoEasing>(remembered.easing);
  const [long, setLong] = useState<VideoLong>(remembered.long);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<(VideoResult & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(hasVideoEncoder);
  const abortRef = useRef<AbortController | null>(null);
  const renderRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => { remembered = { seconds, hold, easing, long }; }, [seconds, hold, easing, long]);
  // Closing the sheet stops a render in progress.
  useEffect(() => () => abortRef.current?.abort(), []);
  // A file that was shown is revoked a little later, so a download that just started finishes.
  useEffect(() => {
    const url = result?.url;
    return () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 30_000); };
  }, [result]);
  useEffect(() => onWide(phase === 'done'), [phase, onWide]);
  useEffect(() => {
    const el = phase === 'setup' ? renderRef.current : phase === 'rendering' ? cancelRef.current : saveRef.current;
    if (el && !(el as HTMLButtonElement).disabled) el.focus();
    else document.getElementById('sheetClose')?.focus();
  }, [phase]);

  const visible = doc.slots.slice(0, doc.count);
  const chosen = slot != null ? doc.slots[slot] : null;
  const axis = chosen ? scrollAxis(chosen) : null;
  const sizes: Option<VideoLong>[] = VIDEO_SIZES.map((l) => {
    const s = videoSize(doc.W, doc.H, l);
    return { value: l, label: `${s.w} × ${s.h}` };
  });

  const start = async () => {
    if (slot == null || phase === 'rendering') return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setProgress({ done: 0, total: frameCount(seconds) });
    setPhase('rendering');
    let shown = 0;
    try {
      // Pin text may have changed since the sheet opened; nothing it draws has.
      const r = await renderScrollVideo(clone(useEditor.getState().doc), { slot, seconds, hold, easing, long }, {
        signal: ac.signal,
        onProgress(done, total) {
          const now = performance.now();
          if (done === total || now - shown > 80) { shown = now; setProgress({ done, total }); }
        },
      });
      if (ac.signal.aborted) return;
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
      setPhase('done');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(
        e instanceof VideoUnsupportedError
          ? 'This browser can’t make an MP4 at this size. Try a smaller size, or Chrome, Edge or Safari.'
          : 'Couldn’t make the video. Try a smaller size.',
      );
      setPhase('setup');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('setup');
    notify('Cancelled.');
  };

  if (phase === 'done' && result) {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return (
      <div className="sheet-split">
        <div className="sheet-main">
          <div className="sheet-preview">
            <video id="vidPreview" src={result.url} controls loop muted playsInline autoPlay={!reduce} aria-label="Preview of the video" />
          </div>
          <div className="sheet-meta">
            <strong id="vidName">{result.name}</strong>
            <span className="fine" id="vidMeta">{`${result.w} × ${result.h} px · ${fmtSeconds(result.seconds)} · MP4 · ${fmtBytes(result.blob.size)}`}</span>
          </div>
          <div className="sheet-actions">
            <button className="btn" id="vidAgain" type="button" onClick={() => setPhase('setup')}>Change settings</button>
            <a className="btn primary" id="vidSave" href={result.url} download={result.name} ref={saveRef}>Save file</a>
          </div>
        </div>
        <PinTextSection notify={notify} />
      </div>
    );
  }

  if (phase === 'rendering') {
    const pct = progress.total ? Math.floor((progress.done / progress.total) * 100) : 0;
    return (
      <>
        <div className="vid-progress">
          <progress id="vidProgress" max={progress.total || 1} value={progress.done} aria-label="Rendering the video" />
          <div className="vid-progress-text">
            <span className="fine" role="status">Rendering the video…</span>
            <span className="fine vid-count" aria-hidden="true">{`Frame ${progress.done} of ${progress.total} · ${pct}%`}</span>
          </div>
        </div>
        <div className="sheet-actions">
          <button className="btn" id="vidCancel" type="button" ref={cancelRef} onClick={cancel}>Cancel</button>
        </div>
      </>
    );
  }

  const none = !visible.some(canScroll);
  return (
    <>
      <p className="fine">One layout scrolls through its page while everything else stays still. Pinterest takes it as a video pin, Etsy as a listing video.</p>
      {!supported && <p className="vid-note" role="alert">This browser can’t make videos. Use Chrome, Edge or Safari 16.4 or later.</p>}
      {error && <p className="vid-note" role="alert">{error}</p>}
      <div className="vid-form">
        <div className="vid-field">
          <span className="lbl" id="vidSlotLbl">Scrolls</span>
          <div className="seg" id="vidSlot" role="group" aria-labelledby="vidSlotLbl">
            {visible.map((s, i) => (
              <button
                key={i} type="button" aria-pressed={slot === i} disabled={!canScroll(s)} onClick={() => setSlot(i)}
                title={canScroll(s) ? s.name : 'Shows its whole page'}
              >
                Layout {i + 1}
              </button>
            ))}
          </div>
          <p className="fine vid-hint" id="vidSlotHint">
            {none
              ? 'Every layout shows its whole page. Give one a crop such as 16:10, then come back.'
              : chosen ? `${chosen.name} · ${axis === 'x' ? 'pans left to right' : 'scrolls top to bottom'}` : ''}
          </p>
        </div>
        <div className="row">
          <label htmlFor="vidSeconds">Length</label>
          <input id="vidSeconds" type="range" min={VIDEO_SECONDS.min} max={VIDEO_SECONDS.max} step={1} value={seconds} onChange={(e) => setSeconds(+e.target.value)} />
          <output htmlFor="vidSeconds">{fmtSeconds(seconds)}</output>
        </div>
        <div className="row">
          <label htmlFor="vidHold">Pause at ends</label>
          <input id="vidHold" type="range" min={VIDEO_HOLD.min} max={VIDEO_HOLD.max} step={VIDEO_HOLD.step} value={hold} onChange={(e) => setHold(+e.target.value)} />
          <output htmlFor="vidHold">{fmtSeconds(hold)}</output>
        </div>
        <div className="vid-field">
          <span className="lbl" aria-hidden="true">Motion</span>
          <Seg label="Motion" options={EASINGS} value={easing} onPick={setEasing} />
        </div>
        <div className="vid-field">
          <span className="lbl" aria-hidden="true">Size</span>
          <Seg label="Size in pixels" options={sizes} value={long} onPick={setLong} />
        </div>
      </div>
      <p className="fine">MP4 (H.264), 30 fps, no sound.</p>
      <div className="sheet-actions">
        <button className="btn" id="sheetBack" type="button" onClick={onClose}>Back to editing</button>
        <button className="btn primary" id="vidRender" type="button" ref={renderRef} disabled={!supported || slot == null} onClick={() => void start()}>
          Render video
        </button>
      </div>
    </>
  );
}
