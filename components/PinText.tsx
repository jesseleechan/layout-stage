'use client';
/* Pin text in the export sheet: title, description, alt text and destination link, suggested from the
   canvas (lib/pin-text.ts) and ready to copy. Typing keeps the text with the canvas (one undo step per
   pause, and one when the field loses focus); "Reset to suggestion" goes back to the template. */
import { useEffect, useMemo, useRef } from 'react';
import { useEditor } from '@/lib/store';
import { copyAllText, PIN_FIELDS, PIN_LABELS, PIN_LIMITS, pinTextOf, type PinField } from '@/lib/pin-text';
import './pin-text.css';

/** Typing saves one undo step after this much idle (as in the Text & logo panel). */
const TYPE_IDLE_MS = 600;
const st = () => useEditor.getState();

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

const ROWS: Partial<Record<PinField, number>> = { description: 4, alt: 3 };
const PLACEHOLDERS: Record<PinField, string> = {
  title: 'A short, searchable title',
  description: 'What the pin shows and why to save it',
  alt: 'Describe the image for people who can’t see it',
  link: 'https://… the page this pin opens',
};

/** Copies text with the async Clipboard API; on failure selects the field so ⌘C / Ctrl+C works. */
function copyText(text: string, done: string, notify: (msg: string) => void, field?: HTMLInputElement | HTMLTextAreaElement | null) {
  const fail = () => {
    if (field) {
      field.focus();
      field.select();
      notify('Couldn’t copy. The text is selected: press ⌘C or Ctrl+C.');
    } else notify('Couldn’t copy. Copy each field instead.');
  };
  try {
    navigator.clipboard.writeText(text).then(() => notify(done), fail);
  } catch {
    fail();
  }
}

export default function PinTextSection({ notify }: { notify: (msg: string) => void }) {
  // As a string, so the section only re-renders when the text changes (the store clones `doc` on every edit).
  const key = useEditor((s) => JSON.stringify(pinTextOf(s.doc)));
  const { values, edited } = useMemo(() => JSON.parse(key) as ReturnType<typeof pinTextOf>, [key]);
  const typing = useTypingCommit();
  const refs = useRef<Partial<Record<PinField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const reset = (f: PinField) => {
    typing.flush();
    st().resetPinText(f);
    refs.current[f]?.focus();
  };

  return (
    <section className="pin-text" aria-labelledby="pinTextTitle">
      <div className="pin-head">
        <h3 id="pinTextTitle">Pin text</h3>
        <button className="btn sm" id="pinCopyAll" type="button" onClick={() => copyText(copyAllText(values), 'Pin text copied.', notify)}>
          Copy all
        </button>
      </div>
      <p className="fine">Suggested from your canvas. Your edits are kept with it.</p>
      {PIN_FIELDS.map((f) => {
        const id = `pin-${f}`;
        const label = PIN_LABELS[f];
        const v = values[f];
        const counted = f !== 'link';
        const props = {
          id,
          className: 'pin-input',
          value: v,
          maxLength: PIN_LIMITS[f],
          placeholder: PLACEHOLDERS[f],
          spellCheck: f !== 'link',
          'aria-describedby': counted ? `${id}-count` : undefined,
          onChange: (e: { target: { value: string } }) => { st().editPinText(f, e.target.value); typing.typed(); },
          onBlur: typing.flush,
        };
        return (
          <div className="pin-field" key={f}>
            <label htmlFor={id}>{label}</label>
            {ROWS[f] ? (
              <textarea {...props} rows={ROWS[f]} ref={(el) => { refs.current[f] = el; }} />
            ) : (
              <input {...props} type={f === 'link' ? 'url' : 'text'} inputMode={f === 'link' ? 'url' : undefined} ref={(el) => { refs.current[f] = el; }} />
            )}
            <div className="pin-tools">
              {counted && (
                <span className="pin-count" id={`${id}-count`} data-full={v.length >= PIN_LIMITS[f]}>
                  {v.length}/{PIN_LIMITS[f]}
                </span>
              )}
              {edited[f] && (
                <button className="btn xs" type="button" id={`${id}-reset`} aria-label={`Reset ${label.toLowerCase()} to suggestion`} onClick={() => reset(f)}>
                  Reset to suggestion
                </button>
              )}
              <button
                className="btn xs" type="button" id={`${id}-copy`} aria-label={`Copy ${label.toLowerCase()}`} disabled={!v.trim()}
                onClick={() => copyText(v.trim(), `${label} copied.`, notify, refs.current[f])}
              >
                Copy
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
