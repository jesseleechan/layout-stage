/* sanitizeComposition: repairs missing or unusable slot sources and never throws on damaged input. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { clone, DEFAULT_CAPTURE } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';

describe('sanitizeComposition', () => {
  it('round-trips a valid canvas', () => {
    const out = sanitizeComposition(clone(defaultComposition()));
    expect(out).not.toBeNull();
  });

  it('repairs a slot with no source instead of throwing', () => {
    const d = clone(defaultComposition());
    delete (d.slots[1] as { source?: unknown }).source;
    const out = sanitizeComposition(d);
    expect(out).not.toBeNull();
    expect(out!.slots[1].source).toEqual({ kind: 'file' });
  });

  it('repairs a url source missing url or options', () => {
    const d = clone(defaultComposition());
    d.slots[0].source = { kind: 'url' } as never;
    const out = sanitizeComposition(d);
    expect(out).not.toBeNull();
    expect(out!.slots[0].source).toEqual({ kind: 'file' });
  });

  it('keeps a valid url source', () => {
    const d = clone(defaultComposition());
    const src = { kind: 'url', url: 'https://example.com', capturedAt: '2026-10-01T00:00:00.000Z', options: DEFAULT_CAPTURE } as const;
    d.slots[0].source = src;
    const out = sanitizeComposition(d);
    expect(out).not.toBeNull();
    expect(out!.slots[0].source.kind).toBe('url');
  });

  it('returns null without throwing on garbage input', () => {
    for (const bad of [null, 'x', {}, { W: 1000, H: 1500, slots: [1, 2, 3] }, { W: 1000, H: 1500, slots: [{}, {}, {}] }]) {
      expect(sanitizeComposition(bad)).toBeNull();
    }
  });

  it('does not throw when media is not an array', () => {
    const d = clone(defaultComposition());
    d.media = 5 as never;
    expect(() => sanitizeComposition(d)).not.toThrow();
  });

  it('round-trips transparent backgrounds and repairs unknown background types', () => {
    const d = clone(defaultComposition());
    d.background.type = 'transparent';
    expect(sanitizeComposition(d)!.background.type).toBe('transparent');

    (d.background as { type: unknown }).type = 'bogus';
    expect(sanitizeComposition(d)!.background.type).toBe(defaultComposition().background.type);
  });
});
