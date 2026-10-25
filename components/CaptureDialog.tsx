'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useEditor } from '@/lib/store';
import { CAPTURE_WIDTHS, DEFAULT_CAPTURE, type CaptureOptions } from '@/lib/model';
import { addRecentUrl, captureName, captureUrl, getRecentUrls, normalizeUrl, precheckUrl, TRIMMED_MESSAGE } from '@/lib/capture/client';
import { CAPTURE_MESSAGES, CaptureError } from '@/lib/capture/errors';
import './capture.css';

/* Capture from URL: a small sheet over the editor. The capture runs as a store job, so the sheet can
   be closed while it works; the target slot shows "Capturing…" until the image lands. */

/** Last-used options, kept for the session only. */
let sessionOptions: CaptureOptions = { ...DEFAULT_CAPTURE };
/** The job the open sheet is waiting on. Errors for any other job become toasts. */
let watchedJob: number | null = null;

export default function CaptureDialog() {
  const open = useEditor((s) => s.captureDialog.open);
  const target = useEditor((s) => s.captureDialog.target);
  return open ? <CaptureSheet key={target ?? 'new'} target={target} /> : null;
}

/** Replacing a captured layout starts from its URL and options, so a changed site is one click away. */
function initialForm(target: number | null): { url: string; options: CaptureOptions } {
  const { doc } = useEditor.getState();
  const src = target != null && target < doc.count ? doc.slots[target].source : null;
  if (src?.kind === 'url') return { url: src.url, options: { ...src.options } };
  return { url: '', options: { ...sessionOptions } };
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

function CaptureSheet({ target }: { target: number | null }) {
  const closeCapture = useEditor((s) => s.closeCapture);
  const [init] = useState(() => initialForm(target));
  const [url, setUrl] = useState(init.url);
  const [opts, setOpts] = useState<CaptureOptions>(init.options);
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const downOnScrim = useRef(false);
  const live = useRef(true);
  const uid = useId();
  const ids = { title: `${uid}t`, url: `${uid}u`, list: `${uid}l`, hint: `${uid}h`, err: `${uid}e`, width: `${uid}w`, page: `${uid}p`, scale: `${uid}s`, delay: `${uid}d` };

  // Focus the URL field on open; give focus back to whatever opened the sheet on close.
  useEffect(() => {
    live.current = true;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    urlRef.current?.focus();
    urlRef.current?.select();
    return () => {
      live.current = false;
      watchedJob = null;
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  useEffect(() => {
    let on = true;
    void getRecentUrls().then((r) => on && setRecent(r));
    return () => {
      on = false;
    };
  }, []);

  // Esc closes, before the editor's own Esc (deselect) sees it.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeCapture();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeCapture]);

  useEffect(() => {
    if (error && !busy) urlRef.current?.focus();
  }, [error, busy]);

  const set = (patch: Partial<CaptureOptions>) => setOpts((o) => ({ ...o, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const u = normalizeUrl(url);
    const pre = u ? precheckUrl(u) : new CaptureError('invalid_url', 'Paste the address of the page to capture.');
    if (pre) {
      setError(pre.message);
      urlRef.current?.focus();
      return;
    }
    setUrl(u);
    const options = { ...opts };
    sessionOptions = options;
    const job = useEditor.getState().startCaptureJob(u, target);
    watchedJob = job;
    setError(null);
    setBusy(true);
    closeRef.current?.focus(); // the form is disabled while it works
    try {
      const { blob, trimmed, finalUrl } = await captureUrl(u, options);
      const { doc, addImage, showToast } = useEditor.getState();
      const slot = target != null && target < doc.count ? target : null; // the layout may have been removed meanwhile
      const source = { kind: 'url' as const, url: u, capturedAt: new Date().toISOString(), options };
      if (await addImage({ blob, name: captureName(finalUrl), source }, slot)) {
        void addRecentUrl(u);
        if (trimmed) showToast(TRIMMED_MESSAGE);
      }
      if (watchedJob === job) useEditor.getState().closeCapture();
    } catch (err) {
      const msg = err instanceof CaptureError ? err.message : CAPTURE_MESSAGES.failed;
      if (watchedJob === job && live.current && useEditor.getState().captureDialog.open) setError(msg);
      else useEditor.getState().showToast(msg);
    } finally {
      useEditor.getState().endCaptureJob(job);
      if (watchedJob === job) watchedJob = null;
      if (live.current) setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation(); // keep editor shortcuts (arrows, ⌘Z, [ ]) out of the form
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const sec = (opts.delayMs / 1000).toFixed(1);
  const title = target == null ? 'Capture from URL' : `Replace layout ${target + 1} from URL`;

  return (
    <div
      className="sheet capture"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.title}
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnScrim.current && e.target === e.currentTarget) closeCapture();
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => e.stopPropagation()}
    >
      <div className="sheet-card" ref={cardRef}>
        <div className="sheet-head">
          <h2 id={ids.title}>{title}</h2>
          <button className="icon-btn" type="button" aria-label="Close" onClick={closeCapture}>
            ✕
          </button>
        </div>
        <form className="cap-form" onSubmit={submit} noValidate>
          <fieldset disabled={busy}>
            <div className="cap-field">
              <label className="cap-label" htmlFor={ids.url}>
                Web address
              </label>
              <input
                ref={urlRef}
                id={ids.url}
                className="cap-input"
                type="url"
                inputMode="url"
                list={ids.list}
                placeholder="https://example.com/pricing"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? ids.err : ids.hint}
              />
              <datalist id={ids.list}>
                {recent.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <p className="fine" id={ids.hint}>
                Public pages only. Pages behind a login can’t be captured.
              </p>
            </div>

            <div className="cap-field">
              <span className="cap-label" id={ids.width}>
                Device width
              </span>
              <div className="seg cap-widths" role="group" aria-labelledby={ids.width}>
                {CAPTURE_WIDTHS.map(({ width, label }) => (
                  <button key={width} type="button" aria-pressed={opts.width === width} onClick={() => set({ width })}>
                    <span>{label.replace(/\s*\d+$/, '')}</span>
                    <small>{width}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="cap-pair">
              <div className="cap-field">
                <span className="cap-label" id={ids.page}>
                  Capture
                </span>
                <div className="seg" role="group" aria-labelledby={ids.page}>
                  <button type="button" aria-pressed={opts.fullPage} onClick={() => set({ fullPage: true })}>
                    Full page
                  </button>
                  <button type="button" aria-pressed={!opts.fullPage} onClick={() => set({ fullPage: false })}>
                    First screen
                  </button>
                </div>
              </div>
              <div className="cap-field">
                <span className="cap-label" id={ids.scale}>
                  Sharpness
                </span>
                <div className="seg" role="group" aria-labelledby={ids.scale}>
                  {([1, 2] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={opts.scale === s} onClick={() => set({ scale: s })}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="row">
              <label htmlFor={ids.delay}>Delay before capture</label>
              <input
                id={ids.delay}
                type="range"
                min={0}
                max={5000}
                step={500}
                value={opts.delayMs}
                aria-valuetext={`${sec} seconds`}
                onChange={(e) => set({ delayMs: Number(e.target.value) })}
              />
              <output htmlFor={ids.delay}>{sec} s</output>
            </div>

            <label className="cap-check">
              <input type="checkbox" checked={opts.hideBanners} onChange={(e) => set({ hideBanners: e.target.checked })} />
              Hide cookie banners
            </label>
          </fieldset>

          {error && (
            <p className="cap-error" id={ids.err} role="alert">
              {error}
            </p>
          )}
          <p className="cap-status fine" role="status" aria-live="polite">
            {busy && (
              <>
                <span className="cap-spin" aria-hidden="true" />
                Capturing… You can close this; the layout updates when it’s done.
              </>
            )}
          </p>

          <div className="sheet-actions">
            <button ref={closeRef} className="btn" type="button" onClick={closeCapture}>
              {busy ? 'Close' : 'Cancel'}
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Capturing…' : 'Capture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
