import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { firstRowToNone, makeIhdr, readPng, stitchPngs, unfilter, writePng } from '@/lib/capture/png';

/** Forward PNG filter for one row (raw bytes, row above, bytes per pixel). */
function filterRow(f: number, row: Uint8Array, up: Uint8Array, bpp: number): Buffer {
  const out = Buffer.alloc(row.length + 1);
  out[0] = f;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = up[i];
    const c = i >= bpp ? up[i - bpp] : 0;
    let p = 0;
    if (f === 1) p = a;
    else if (f === 2) p = b;
    else if (f === 3) p = (a + b) >> 1;
    else if (f === 4) {
      const q = a + b - c;
      const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i + 1] = (row[i] - p) & 0xff;
  }
  return out;
}

/** A PNG whose rows use the given filters in turn. */
function encode(width: number, rows: Uint8Array[], colorType: number, filters: number[]): Buffer {
  const bpp = colorType === 6 ? 4 : 3;
  const parts = rows.map((row, y) => filterRow(filters[y % filters.length], row, y ? rows[y - 1] : new Uint8Array(row.length), bpp));
  return writePng(makeIhdr(width, rows.length, 8, colorType), deflateSync(Buffer.concat(parts)));
}

/** Deterministic noisy pixels so every filter does real work. */
function pixels(width: number, height: number, bpp: number, seed: number): Uint8Array[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
  return Array.from({ length: height }, () => Uint8Array.from({ length: width * bpp }, rnd));
}

const decode = (png: Buffer) => {
  const p = readPng(png);
  return { ...p, raw: unfilter(inflateSync(p.idat), p.width, p.height, p.bpp) };
};

describe('PNG slices', () => {
  it.each([
    [6, 'RGBA'],
    [2, 'RGB'],
  ])('joins %s (%s) slices whose first rows use every filter type', async (colorType) => {
    const bpp = colorType === 6 ? 4 : 3;
    const width = 7;
    const slices = [0, 1, 2, 3, 4].map((f, k) => pixels(width, 3 + k, bpp, 17 + k));
    // Each slice starts with a different filter (then cycles), so every boundary case is covered.
    const pngs = slices.map((rows, k) => encode(width, rows, colorType, [k, (k + 1) % 5, (k + 2) % 5, (k + 3) % 5, (k + 4) % 5]));
    const joined = decode(await stitchPngs(pngs));
    expect(joined.width).toBe(width);
    expect(joined.height).toBe(slices.reduce((h, s) => h + s.length, 0));
    expect(joined.colorType).toBe(colorType);
    expect(Buffer.from(joined.raw)).toEqual(Buffer.concat(slices.flat()));
  });

  it('returns a single slice unchanged and refuses mismatched widths', async () => {
    const one = encode(4, pixels(4, 2, 4, 1), 6, [4]);
    expect(await stitchPngs([one])).toBe(one);
    await expect(stitchPngs([one, encode(5, pixels(5, 2, 4, 2), 6, [0])])).rejects.toThrow(/differ/);
  });

  it('rewrites a first row as filter None', () => {
    const raw = Uint8Array.from([10, 20, 30, 40, 250, 5, 6, 7, 1, 2, 3, 4]);
    for (const f of [0, 1, 2, 3, 4]) {
      const row = filterRow(f, raw, new Uint8Array(raw.length), 4);
      firstRowToNone(row, 4);
      expect(row[0]).toBe(0);
      expect(Array.from(row.subarray(1))).toEqual(Array.from(raw));
    }
  });

  it('rejects things that are not PNGs', () => {
    expect(() => readPng(Buffer.from('nope'))).toThrow();
  });
});
