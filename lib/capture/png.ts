/* Joins PNG slices of the same width top to bottom, without an image library. Chromium leaves parts
   of very tall 2× screenshots blank (it runs out of tile memory), so tall pages are captured in
   slices. A PNG's pixels are filtered scanlines in one zlib stream, so joining means: inflate each
   slice, rewrite the first row of every later slice with filter None (filters look at the row
   above, which was all zeros at the top of the slice), and deflate the lot once. Server only. */
import { once } from 'node:events';
import { createDeflate, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grey, RGB, grey+alpha, RGBA

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Bytes per pixel (at least 1), as the filters use it. */
  bpp: number;
  /** IHDR chunk data, 13 bytes. */
  ihdr: Buffer;
  /** Concatenated IDAT data (one zlib stream). */
  idat: Buffer;
}

export function readPng(buf: Buffer): PngInfo {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || ihdr.length !== 13) throw new Error('PNG without IHDR');
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (!(colorType in CHANNELS) || (bitDepth !== 8 && bitDepth !== 16) || ihdr[12] !== 0) throw new Error('unsupported PNG layout');
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth,
    colorType,
    bpp: (CHANNELS[colorType] * bitDepth) / 8,
    ihdr,
    idat: Buffer.concat(idat),
  };
}

/** Rewrites a slice's first scanline (filter byte + bytes) with filter None, in place. The row
 *  above it was all zeros, so Up equals None and Paeth equals Sub. */
export function firstRowToNone(row: Buffer, bpp: number): void {
  const f = row[0];
  if (f === 1 || f === 3 || f === 4) {
    for (let i = 1; i < row.length; i++) {
      const left = i - bpp >= 1 ? row[i - bpp] : 0;
      row[i] = (row[i] + (f === 3 ? left >> 1 : left)) & 0xff;
    }
  } else if (f !== 0 && f !== 2) throw new Error(`bad PNG filter ${f}`);
  row[0] = 0;
}

/** Undoes all filters (for tests and checks): returns raw rows without filter bytes. */
export function unfilter(data: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = data[y * (stride + 1)];
    const src = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
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
      row[i] = (src[i] + p) & 0xff;
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(...parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, crc]);
}

export function makeIhdr(width: number, height: number, bitDepth: number, colorType: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return ihdr; // compression, filter method and interlace stay 0
}

/** A PNG from IHDR data and one compressed IDAT stream. */
export function writePng(ihdr: Buffer, idat: Buffer): Buffer {
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Joins same-width PNG slices top to bottom into one PNG. */
export async function stitchPngs(slices: Buffer[]): Promise<Buffer> {
  if (slices.length === 1) return slices[0];
  const pngs = slices.map(readPng);
  const [first] = pngs;
  if (!pngs.every((p) => p.width === first.width && p.bitDepth === first.bitDepth && p.colorType === first.colorType)) {
    throw new Error('PNG slices differ in width or format');
  }
  const rowLen = first.width * first.bpp + 1;
  const deflate = createDeflate({ level: 4 }); // ~3× faster than the default for ~5% more bytes
  const out: Buffer[] = [];
  deflate.on('data', (d: Buffer) => out.push(d));
  const finished = once(deflate, 'end');
  for (let i = 0; i < pngs.length; i++) {
    const data = inflateSync(pngs[i].idat);
    if (data.length !== rowLen * pngs[i].height) throw new Error('PNG slice has the wrong size');
    if (i > 0) firstRowToNone(data.subarray(0, rowLen), first.bpp);
    if (!deflate.write(data)) await once(deflate, 'drain');
  }
  deflate.end();
  await finished;
  const ihdr = Buffer.from(first.ihdr);
  ihdr.writeUInt32BE(pngs.reduce((h, p) => h + p.height, 0), 4);
  return writePng(ihdr, Buffer.concat(out));
}
