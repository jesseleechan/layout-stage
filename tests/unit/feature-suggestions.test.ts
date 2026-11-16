import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { PRESET_IDS, PRESETS } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { slotFrame } from '@/lib/render/units';

describe('feature suggestions', () => {
  it('includes Landscape 16:9 and Square 1:1 presets', () => {
    expect(PRESET_IDS).toContain('land169');
    expect(PRESET_IDS).toContain('sq11');
    expect(PRESETS.land169).toMatchObject({ w: 1920, h: 1080 });
    expect(PRESETS.sq11).toMatchObject({ w: 1080, h: 1080 });
  });

  it('applies phone bezel only when phoneFrame is on and slot is a phone page', () => {
    const doc = defaultComposition();
    const base = doc.frame;
    const desktopSlot = { source: { kind: 'file' as const }, nw: 1440, nh: 900 };
    const phoneSlot = { source: { kind: 'file' as const }, nw: 390, nh: 844 };

    expect(slotFrame(phoneSlot, base)).toBe(base);
    const withPhone = { ...base, phoneFrame: true };
    expect(slotFrame(desktopSlot, withPhone)).toBe(withPhone);
    const applied = slotFrame(phoneSlot, withPhone);
    expect(applied.radius).toBeGreaterThanOrEqual(42);
    expect(applied.borderW).toBeGreaterThanOrEqual(14);
    expect(applied.borderC).toBe('#16161A');
  });

  it('sanitizes tilt and phoneFrame cleanly', () => {
    const doc = defaultComposition();
    doc.tilt = 12.4;
    doc.frame.phoneFrame = true;
    const clean = sanitizeComposition(doc)!;
    expect(clean.tilt).toBe(12);
    expect(clean.frame.phoneFrame).toBe(true);

    doc.tilt = 0;
    doc.frame.phoneFrame = false;
    const stripped = sanitizeComposition(doc)!;
    expect(stripped.tilt).toBeUndefined();
    expect(stripped.frame.phoneFrame).toBeUndefined();
  });
});
