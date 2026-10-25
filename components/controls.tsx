'use client';
/* Shared panel controls. Sliders and color pickers update the store live on `input` (React's
   onChange) and save one undo step on the native `change` event (slider release / picker close). */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useEditor } from '@/lib/store';

export type Fmt = 'num' | 'pct' | 'deg' | 'hex';

/** Output text, formatted like the prototype's syncBound. */
export function fmt(v: number | string, f: Fmt = 'num'): string {
  if (f === 'hex') return String(v).toUpperCase();
  const n = +v;
  if (f === 'pct') return Math.round(n * 100) + '%';
  if (f === 'deg') return Math.round(n) + '°';
  return String(Math.round(n));
}

/** Attaches a native 'change' listener that commits one undo step. */
export function useCommitOnChange<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => useEditor.getState().commit();
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, []);
  return ref;
}

interface RangeProps {
  id: string;
  label: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  onInput: (v: number) => void;
  /** Output text; defaults to the rounded value. */
  out?: string;
  format?: Fmt;
}

export function RangeRow({ id, label, min, max, step = 1, value, onInput, out, format = 'num' }: RangeProps) {
  const ref = useCommitOnChange<HTMLInputElement>();
  return (
    <div className="row">
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onInput(+e.target.value)} />
      <output htmlFor={id}>{out ?? fmt(value, format)}</output>
    </div>
  );
}

interface ColorProps {
  id?: string;
  value: string;
  onInput: (v: string) => void;
  'aria-label'?: string;
}

/** A bare color input (value is lowercase, as the native control reports it). */
export function ColorInput({ id, value, onInput, 'aria-label': ariaLabel }: ColorProps) {
  const ref = useCommitOnChange<HTMLInputElement>();
  return <input ref={ref} id={id} type="color" aria-label={ariaLabel} value={String(value).toLowerCase()} onChange={(e) => onInput(e.target.value)} />;
}

export function ColorRow({ id, label, value, onInput }: { id: string; label: ReactNode; value: string; onInput: (v: string) => void }) {
  return (
    <div className="row color">
      <label htmlFor={id}>{label}</label>
      <span className="swatch-field">
        <ColorInput id={id} value={value} onInput={onInput} />
        <output htmlFor={id}>{fmt(value, 'hex')}</output>
      </span>
    </div>
  );
}

export interface Option<T> {
  value: T;
  label: ReactNode;
  'aria-label'?: string;
}

/** Segmented control (.seg): one pressed button. */
export function Seg<T extends string | number>({ label, options, value, onPick, className }: {
  label: string;
  options: Option<T>[];
  value: T;
  onPick: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={className ? `seg ${className}` : 'seg'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} aria-label={o['aria-label']} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chip group (.chips): one pressed chip (or none). */
export function Chips<T extends string>({ label, options, value, onPick, id }: {
  label: string;
  options: Option<T>[];
  value: T | null;
  onPick: (v: T) => void;
  id?: string;
}) {
  return (
    <div className="chips" id={id} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className="chip" type="button" aria-pressed={o.value === value} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `--cols` for .swatches. */
export const cols = (n: number) => ({ '--cols': n }) as CSSProperties;
