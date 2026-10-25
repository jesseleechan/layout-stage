'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useEditor } from '@/lib/store';
import { CAPTURE_WIDTHS, DEFAULT_CAPTURE, type CaptureOptions } from '@/lib/model';
import { getRecentUrls, normalizeUrl, precheckUrl } from '@/lib/capture/client';
import { CaptureError } from '@/lib/capture/errors';
import { authProblem, splitUrlCredentials, type CaptureAuth } from '@/lib/capture/auth';
import { parseSelectors, selectorsText } from '@/lib/capture/selectors';
import { errorMessage, runJobs, startJobs } from '@/lib/capture/jobs';
import './capture.css';

/* Capture from URL: a small sheet over the editor. The capture runs as a store job, so the sheet can
   be closed while it works; the target slot shows "Capturing…" until the image lands. */

/** Last-used options, kept for the session only (never the username or password). */
let sessionOptions: CaptureOptions = { ...DEFAULT_CAPTURE };
let sessionPair = false;
/** The job the open sheet is waiting on. Errors for any other job become toasts. */
let watchedJob: number | null = null;

export default function CaptureDialog() {
  const open = useEditor((s) => s.captureDialog.open);
  const target = useEditor((s) => s.captureDialog.target);
  const recapture = useEditor((s) => !!s.captureDialog.recapture);
  return open ? <CaptureSheet key={`${target ?? 'new'}${recapture ? 'r' : ''}`} target={target} recapture={recapture} /> : null;
}

interface Form {
  url: string;
  options: CaptureOptions;
  pair: boolean;
  /** The layout was captured with a password, which isn't stored: ask for it again. */
  needsPassword: boolean;
}

/** Replacing a captured layout starts from its URL and options, so a changed site is one click away. */
function initialForm(target: number | null): Form {
  const { doc } = useEditor.getState();
  const src = target != null && target < doc.count ? doc.slots[target].source : null;
  if (src?.kind === 'url') return { url: src.url, options: { ...DEFAULT_CAPTURE, ...src.options }, pair: false, needsPassword: !!src.needsPassword };
  return { url: '', options: { ...sessionOptions }, pair: sessionPair, needsPassword: false };
}

/** Which field an error message belongs to (it's shown under the form and that field is marked). */
type Field = 'url' | 'hide' | 'auth';
const fieldOf = (e: unknown): Field => {
  const code = e instanceof CaptureError ? e.code : '';
  return code === 'bad_selectors' ? 'hide' : code === 'auth_required' || code === 'auth_failed' || code === 'bad_auth' ? 'auth' : 'url';
};

/** The browser's own check of each selector (the server re-checks their shape). */
function invalidSelector(selectors: string[]): string | null {
  const probe = document.createDocumentFragment();
  for (const s of selectors) {
    try {
      probe.querySelector(s);
    } catch {
      return s;
    }
  }
  return null;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

function CaptureSheet({ target, recapture }: { target: number | null; recapture: boolean }) {
  const closeCapture = useEditor((s) => s.closeCapture);
  const [init] = useState(() => initialForm(target));
  const [url, setUrl] = useState(init.url);
  const [opts, setOpts] = useState<CaptureOptions>(init.options);
  const [pair, setPair] = useState(init.pair);
  const [hideText, setHideText] = useState(() => selectorsText(init.options.hideSelectors));
  const [authOpen, setAuthOpen] = useState(init.needsPassword);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field; msg: string } | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const hideRef = useRef<HTMLTextAreaElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const downOnScrim = useRef(false);
  const live = useRef(true);
  const uid = useId();
  const ids = {
    title: `${uid}t`, url: `${uid}u`, list: `${uid}l`, hint: `${uid}h`, err: `${uid}e`, width: `${uid}w`, page: `${uid}p`, scale: `${uid}s`,
    delay: `${uid}d`, hide: `${uid}x`, hideHint: `${uid}xh`, user: `${uid}n`, pass: `${uid}pw`, authHint: `${uid}ah`,
  };

  // Focus the URL field on open (the username when only the password is missing); give focus back
  // to whatever opened the sheet on close.
  useEffect(() => {
    live.current = true;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (init.needsPassword) userRef.current?.focus();
    else {
      urlRef.current?.focus();
      urlRef.current?.select();
    }
    return () => {
      live.current = false;
      watchedJob = null;
      if (prev?.isConnected) prev.focus();
    };
  }, [init.needsPassword]);

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
    if (!error || busy) return;
    if (error.field === 'auth') setAuthOpen(true);
    const el = error.field === 'hide' ? hideRef.current : error.field === 'auth' ? userRef.current : urlRef.current;
    // An opened <details> shows its fields on the next frame.
    requestAnimationFrame(() => el?.focus());
  }, [error, busy]);

  const set = (patch: Partial<CaptureOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const fail = (field: Field, msg: string) => setError({ field, msg });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    // A user name and password typed into the address move to their own fields, out of the address
    // (which is stored with the layout and in recent URLs).
    const split = splitUrlCredentials(normalizeUrl(url));
    const u = split.url;
    let auth: CaptureAuth | null = username || password ? { username, password } : null;
    if (split.auth) {
      auth = split.auth;
      setUrl(u);
      setUsername(split.auth.username);
      setPassword(split.auth.password);
      setAuthOpen(true);
    }
    const pre = u ? precheckUrl(u) : new CaptureError('invalid_url', 'Paste the address of the page to capture.');
    if (pre) return fail('url', pre.message);
    setUrl(u);
    const hide = parseSelectors(hideText);
    if (!hide.ok) return fail('hide', hide.message);
    const bad = invalidSelector(hide.selectors);
    if (bad != null) return fail('hide', `“${bad.length > 40 ? `${bad.slice(0, 39)}…` : bad}” isn’t a valid CSS selector.`);
    setHideText(selectorsText(hide.selectors));
    const problem = auth && authProblem(auth);
    if (problem) return fail('auth', problem);
    if (init.needsPassword && !auth) return fail('auth', 'Enter the username and password for this page. They aren’t saved.');

    const options: CaptureOptions = { ...opts, hideSelectors: hide.selectors };
    sessionOptions = options;
    sessionPair = pair;
    const jobs = startJobs(u, target, pair);
    watchedJob = jobs[0];
    setError(null);
    setBusy(true);
    closeRef.current?.focus(); // the form is disabled while it works
    try {
      await runJobs(jobs, { url: u, options, auth }, recapture);
      if (watchedJob === jobs[0]) useEditor.getState().closeCapture();
    } catch (err) {
      const msg = errorMessage(err);
      if (watchedJob === jobs[0] && live.current && useEditor.getState().captureDialog.open) fail(fieldOf(err), msg);
      else useEditor.getState().showToast(msg);
    } finally {
      if (watchedJob === jobs[0]) watchedJob = null;
      if (live.current) setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation(); // keep editor shortcuts (arrows, ⌘Z, [ ]) out of the form
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
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
  const n = target == null ? 0 : target + 1;
  const title = recapture ? `Re-capture layout ${n}` : target == null ? 'Capture from URL' : `Replace layout ${n} from URL`;
  const errFor = (f: Field) => (error?.field === f ? ids.err : undefined);
  const describe = (f: Field, hint: string) => [errFor(f), hint].filter(Boolean).join(' ');

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
                aria-invalid={error?.field === 'url' ? true : undefined}
                aria-describedby={describe('url', ids.hint)}
              />
              <datalist id={ids.list}>
                {recent.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <p className="fine" id={ids.hint}>
                Public pages only. Pages behind a sign-in form can’t be captured.
              </p>
            </div>

            <div className="cap-field">
              <span className="cap-label" id={ids.width}>
                Device width
              </span>
              <div className="seg cap-widths" role="group" aria-labelledby={ids.width}>
                {CAPTURE_WIDTHS.map(({ width, label }) => (
                  <button
                    key={width}
                    type="button"
                    aria-pressed={!pair && opts.width === width}
                    onClick={() => {
                      setPair(false);
                      set({ width });
                    }}
                  >
                    <span>{label.replace(/\s*\d+$/, '')}</span>
                    <small>{width}</small>
                  </button>
                ))}
                <button type="button" aria-pressed={pair} title="Desktop and phone" onClick={() => setPair(true)}>
                  <span>Both</span>
                  <small>1440 + 390</small>
                </button>
              </div>
              {pair && (
                <p className="fine">Desktop full page and Phone first screen, into two layouts.</p>
              )}
            </div>

            <div className="cap-pair">
              <div className="cap-field">
                <span className="cap-label" id={ids.page}>
                  Capture
                </span>
                <div className="seg" role="group" aria-labelledby={ids.page}>
                  <button type="button" aria-pressed={pair ? undefined : opts.fullPage} disabled={pair} onClick={() => set({ fullPage: true })}>
                    Full page
                  </button>
                  <button type="button" aria-pressed={pair ? undefined : !opts.fullPage} disabled={pair} onClick={() => set({ fullPage: false })}>
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

            <div className="cap-checks">
              <label className="cap-check">
                <input type="checkbox" checked={opts.hideBanners} onChange={(e) => set({ hideBanners: e.target.checked })} />
                Hide cookie banners
              </label>
              <label className="cap-check">
                <input type="checkbox" checked={opts.darkMode} onChange={(e) => set({ darkMode: e.target.checked })} />
                Dark mode
              </label>
            </div>

            <div className="cap-field">
              <label className="cap-label" htmlFor={ids.hide}>
                Hide elements
              </label>
              <textarea
                ref={hideRef}
                id={ids.hide}
                className="cap-input cap-area"
                rows={2}
                placeholder="#chat-widget, .promo-bar"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={hideText}
                onChange={(e) => {
                  setHideText(e.target.value);
                  if (error?.field === 'hide') setError(null);
                }}
                aria-invalid={error?.field === 'hide' ? true : undefined}
                aria-describedby={describe('hide', ids.hideHint)}
              />
              <p className="fine" id={ids.hideHint}>
                CSS selectors for chat widgets, popups or sticky bars, separated by commas or new lines.
              </p>
            </div>

            <details className="cap-auth" open={authOpen} onToggle={(e) => setAuthOpen(e.currentTarget.open)}>
              <summary>Password-protected site</summary>
              <div className="cap-auth-body">
                <div className="cap-pair">
                  <div className="cap-field">
                    <label className="cap-label" htmlFor={ids.user}>
                      Username
                    </label>
                    <input
                      ref={userRef}
                      id={ids.user}
                      className="cap-input"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      data-1p-ignore=""
                      data-lpignore="true"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        if (error?.field === 'auth') setError(null);
                      }}
                      aria-invalid={error?.field === 'auth' ? true : undefined}
                      aria-describedby={describe('auth', ids.authHint)}
                    />
                  </div>
                  <div className="cap-field">
                    <label className="cap-label" htmlFor={ids.pass}>
                      Password
                    </label>
                    <input
                      id={ids.pass}
                      className="cap-input"
                      type="password"
                      autoComplete="off"
                      data-1p-ignore=""
                      data-lpignore="true"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error?.field === 'auth') setError(null);
                      }}
                      aria-invalid={error?.field === 'auth' ? true : undefined}
                      aria-describedby={describe('auth', ids.authHint)}
                    />
                  </div>
                </div>
                <p className="fine" id={ids.authHint}>
                  {init.needsPassword ? 'This page needs its password again. ' : 'For staging sites that ask for a password before the page loads. '}
                  Sent with this capture only, to this site only, and never saved.
                </p>
              </div>
            </details>
          </fieldset>

          {error && (
            <p className="cap-error" id={ids.err} role="alert">
              {error.msg}
            </p>
          )}
          <p className="cap-status fine" role="status" aria-live="polite">
            {busy && (
              <>
                <span className="cap-spin" aria-hidden="true" />
                Capturing… You can close this; the {pair ? 'layouts update' : 'layout updates'} when it’s done.
              </>
            )}
          </p>

          <div className="sheet-actions">
            <button ref={closeRef} className="btn" type="button" onClick={closeCapture}>
              {busy ? 'Close' : 'Cancel'}
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Capturing…' : recapture ? 'Re-capture' : 'Capture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
