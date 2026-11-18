/* Transparent export behavior: format locking, background type guard, and exportComposition PNG forcing. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { BACKGROUND_TYPES, effectiveExportFormat, isBackgroundType } from '@/lib/model';
import { exportComposition } from '@/lib/render/export';

vi.mock('@/lib/images', () => ({
  loadImage: async () => null,
}));

function stubCanvas() {
  const toBlob = vi.fn((cb: (b: Blob | null) => void, type?: string) => {
    cb(new Blob(['img'], { type: type ?? 'image/png' }));
  });
  const clearRect = vi.fn();
  const fillRect = vi.fn();
  const noop = () => {};
  const makeCtx = () => {
    const ctx = {
      canvas: { width: 0, height: 0 },
      imageSmoothingQuality: 'high',
      imageSmoothingEnabled: true,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      clearRect,
      fillRect,
      save: noop,
      restore: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      arcTo: noop,
      closePath: noop,
      fill: noop,
      clip: noop,
      stroke: noop,
      translate: noop,
      rotate: noop,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createPattern: vi.fn(() => ({})),
      createLinearGradient: vi.fn(() => ({ addColorStop: noop })),
      createRadialGradient: vi.fn(() => ({ addColorStop: noop })),
      drawImage: noop,
      putImageData: noop,
    };
    return ctx;
  };
  vi.stubGlobal('document', {
    createElement: () => {
      const ctx = makeCtx();
      return {
        _w: 0,
        _h: 0,
        get width() { return this._w; },
        set width(v: number) { this._w = v; ctx.canvas.width = v; },
        get height() { return this._h; },
        set height(v: number) { this._h = v; ctx.canvas.height = v; },
        getContext: () => ctx,
        toBlob,
      };
    },
  });
  return { clearRect, fillRect, toBlob };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isBackgroundType', () => {
  it('accepts known background types including transparent and rejects unknown values', () => {
    for (const t of BACKGROUND_TYPES) expect(isBackgroundType(t)).toBe(true);
    expect(isBackgroundType('transparent')).toBe(true);
    for (const bad of ['none', '', null, undefined, 42, {}]) expect(isBackgroundType(bad)).toBe(false);
  });
});

describe('effectiveExportFormat', () => {
  it('forces png for transparent backgrounds even when jpg is requested', () => {
    const d = defaultComposition();
    d.background.type = 'transparent';
    expect(effectiveExportFormat(d, 'jpg')).toBe('png');
    expect(effectiveExportFormat(d, 'png')).toBe('png');
  });

  it('preserves requested format for opaque backgrounds', () => {
    for (const type of ['solid', 'gradient', 'mesh', 'image'] as const) {
      const d = defaultComposition();
      d.background.type = type;
      expect(effectiveExportFormat(d, 'jpg')).toBe('jpg');
      expect(effectiveExportFormat(d, 'png')).toBe('png');
    }
  });
});

describe('exportComposition with transparent background', () => {
  it('encodes PNG and names the file .png even when jpg is passed', async () => {
    const { clearRect, toBlob } = stubCanvas();
    const d = defaultComposition();
    d.background.type = 'transparent';

    const res = await exportComposition(d, 'jpg', 1);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 1000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 0.92);
    expect(res.format).toBe('png');
    expect(res.blob.type).toBe('image/png');
    expect(res.name).toBe('layout-stage-pinterest-1000x1500.png');
    expect([res.w, res.h]).toEqual([1000, 1500]);
  });

  it('keeps jpg encoding for non-transparent backgrounds when jpg is requested', async () => {
    const { toBlob } = stubCanvas();
    const d = defaultComposition();
    d.background.type = 'solid';

    const res = await exportComposition(d, 'jpg', 1);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);
    expect(res.format).toBe('jpg');
    expect(res.blob.type).toBe('image/jpeg');
    expect(res.name).toBe('layout-stage-pinterest-1000x1500.jpg');
  });
});
