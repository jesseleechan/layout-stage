/* The MP4 writer (lib/video/mp4.ts), read back with a small ISO BMFF box parser: the boxes a player
   needs, the moov before the mdat, exact durations, keyframes for seeking, and the chunk offset
   pointing at the first frame. */
import { describe, expect, it } from 'vitest';
import { annexBNals, annexBToAvcc, avcCFrom, colorFrom, compositionOffsets, muxMp4, type Mp4Options, type Mp4Sample } from '@/lib/video/mp4';

interface Box {
  type: string;
  start: number; // of the box header
  size: number;
  body: Uint8Array;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);

function boxes(buf: Uint8Array, start = 0, end = buf.length): Box[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Box[] = [];
  let p = start;
  while (p < end) {
    const size = dv.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    expect(size).toBeGreaterThanOrEqual(8);
    expect(p + size).toBeLessThanOrEqual(end);
    out.push({ type, start: p, size, body: buf.subarray(p + 8, p + size) });
    p += size;
  }
  expect(p).toBe(end);
  return out;
}

/** The box at a path like 'moov/trak/mdia/minf/stbl/stsz'. */
function find(buf: Uint8Array, path: string): Box {
  let list = boxes(buf);
  let hit: Box | undefined;
  for (const name of path.split('/')) {
    hit = list.find((b) => b.type === name);
    if (!hit) throw new Error(`no ${name} in ${path}`);
    if (CONTAINERS.has(name)) list = boxes(buf, hit.start + 8, hit.start + hit.size);
  }
  return hit!;
}
const has = (buf: Uint8Array, path: string) => { try { find(buf, path); return true; } catch { return false; } };

const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o);
const i32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(o);
/** Entries of a full box table: [count, ...rows of n u32]. */
function table(b: Box, n: number, skip = 0): number[][] {
  const count = u32(b.body, 4 + skip);
  return Array.from({ length: count }, (_, i) => Array.from({ length: n }, (_, k) => u32(b.body, 8 + skip + (i * n + k) * 4)));
}

const AVCC = Uint8Array.from([1, 0x64, 0, 0x32, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x32, 1, 0, 2, 0x68, 0xee]);
const OPTS: Mp4Options = { width: 1280, height: 1920, timescale: 30000, frameDuration: 1000, avcC: AVCC };

function frames(n: number): Mp4Sample[] {
  return Array.from({ length: n }, (_, i) => ({ data: new Uint8Array(20 + (i % 7)).fill(i & 255), key: i % 30 === 0, pts: i * 1000 }));
}
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe('mp4 writer', () => {
  const samples = frames(90);
  const file = join(muxMp4(samples, OPTS));

  it('is ftyp, moov, mdat, with the moov first', () => {
    expect(boxes(file).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    const ftyp = find(file, 'ftyp').body;
    expect(String.fromCharCode(...ftyp.subarray(0, 4))).toBe('isom');
  });

  it('has the durations: 90 frames at 30 fps are 3 s', () => {
    const mvhd = find(file, 'moov/mvhd').body;
    expect([u32(mvhd, 12), u32(mvhd, 16)]).toEqual([1000, 3000]); // timescale, duration
    const tkhd = find(file, 'moov/trak/tkhd').body;
    expect(u32(tkhd, 20)).toBe(3000);
    expect([u32(tkhd, 76) / 65536, u32(tkhd, 80) / 65536]).toEqual([1280, 1920]);
    const mdhd = find(file, 'moov/trak/mdia/mdhd').body;
    expect([u32(mdhd, 12), u32(mdhd, 16)]).toEqual([30000, 90000]);
    expect(table(find(file, 'moov/trak/mdia/minf/stbl/stts'), 2)).toEqual([[90, 1000]]);
  });

  it('describes an H.264 video track', () => {
    const hdlr = find(file, 'moov/trak/mdia/hdlr').body;
    expect(String.fromCharCode(...hdlr.subarray(8, 12))).toBe('vide');
    expect(has(file, 'moov/trak/mdia/minf/vmhd')).toBe(true);
    expect(has(file, 'moov/trak/mdia/minf/dinf/dref')).toBe(true);
    const stsd = find(file, 'moov/trak/mdia/minf/stbl/stsd');
    expect(u32(stsd.body, 4)).toBe(1);
    const [avc1] = boxes(file, stsd.start + 16, stsd.start + stsd.size);
    expect(avc1.type).toBe('avc1');
    expect([u16(avc1.body, 24), u16(avc1.body, 26)]).toEqual([1280, 1920]);
    const inner = boxes(file, avc1.start + 8 + 78, avc1.start + avc1.size);
    expect(inner.map((b) => b.type)).toEqual(['avcC']);
    expect(Array.from(inner[0].body)).toEqual(Array.from(AVCC));
  });

  it('lists keyframes, sizes, and one chunk that starts at the first frame', () => {
    expect(table(find(file, 'moov/trak/mdia/minf/stbl/stss'), 1).flat()).toEqual([1, 31, 61]);
    expect(table(find(file, 'moov/trak/mdia/minf/stbl/stsc'), 3)).toEqual([[1, 90, 1]]);
    const stsz = find(file, 'moov/trak/mdia/minf/stbl/stsz').body;
    expect([u32(stsz, 4), u32(stsz, 8)]).toEqual([0, 90]);
    expect(Array.from({ length: 90 }, (_, i) => u32(stsz, 12 + i * 4))).toEqual(samples.map((s) => s.data.length));
    const [[offset]] = table(find(file, 'moov/trak/mdia/minf/stbl/stco'), 1);
    const mdat = find(file, 'mdat');
    expect(offset).toBe(mdat.start + 8);
    expect(Array.from(file.subarray(offset))).toEqual(Array.from(join(samples.map((s) => s.data))));
    expect(has(file, 'moov/trak/mdia/minf/stbl/ctts')).toBe(false);
    expect(has(file, 'moov/trak/edts')).toBe(false);
  });

  it('leaves out stss when every frame is a keyframe, and adds colr when the color is known', () => {
    const all = join(muxMp4(frames(3).map((s) => ({ ...s, key: true })), { ...OPTS, color: { primaries: 1, transfer: 13, matrix: 1, fullRange: true } }));
    expect(has(all, 'moov/trak/mdia/minf/stbl/stss')).toBe(false);
    const stsd = find(all, 'moov/trak/mdia/minf/stbl/stsd');
    const [avc1] = boxes(all, stsd.start + 16, stsd.start + stsd.size);
    const inner = boxes(all, avc1.start + 8 + 78, avc1.start + avc1.size);
    expect(inner.map((b) => b.type)).toEqual(['avcC', 'colr']);
    const colr = inner[1].body;
    expect(String.fromCharCode(...colr.subarray(0, 4))).toBe('nclx');
    expect([u16(colr, 4), u16(colr, 6), u16(colr, 8), colr[10]]).toEqual([1, 13, 1, 0x80]);
  });

  it('frames out of presentation order get composition offsets and an edit list', () => {
    // Decode order I P B B: presented 0, 3, 1, 2.
    const pts = [0, 3, 1, 2, 4, 7, 5, 6];
    const s = pts.map((p, i) => ({ data: new Uint8Array([i]), key: i === 0, pts: p * 1000 }));
    const { offsets, shift } = compositionOffsets(s, 1000);
    expect(shift).toBe(1000); // the B-frames are presented a frame before they are decoded
    // Every frame is presented at its pts plus the shift; the edit list starts the movie at the shift.
    expect(offsets!.map((c, i) => i * 1000 + c - shift)).toEqual(pts.map((p) => p * 1000));
    const f = join(muxMp4(s, OPTS));
    const ctts = table(find(f, 'moov/trak/mdia/minf/stbl/ctts'), 2);
    expect(ctts.reduce((n, [c]) => n + c, 0)).toBe(8);
    const elst = find(f, 'moov/trak/edts/elst').body;
    expect([u32(elst, 4), u32(elst, 8), i32(elst, 12), u16(elst, 16)]).toEqual([1, 267, 1000, 1]);
  });

  it('refuses no frames, or a first frame that is not a keyframe', () => {
    expect(() => muxMp4([], OPTS)).toThrow();
    expect(() => muxMp4(frames(2).map((s) => ({ ...s, key: false })), OPTS)).toThrow();
  });
});

describe('color', () => {
  it('maps WebCodecs color names to code points', () => {
    expect(colorFrom({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true })).toEqual({ primaries: 1, transfer: 13, matrix: 1, fullRange: true });
    expect(colorFrom({ primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false })).toEqual({ primaries: 6, transfer: 6, matrix: 6, fullRange: false });
  });
  it('says nothing when it isn’t sure', () => {
    expect(colorFrom(undefined)).toBeNull();
    expect(colorFrom({ primaries: 'bt709' })).toBeNull();
    expect(colorFrom({ primaries: 'bt709', transfer: 'weird', matrix: 'bt709' })).toBeNull();
  });
});

describe('Annex B frames', () => {
  const SPS = [0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9];
  const PPS = [0x68, 0xeb, 0xe3, 0xcb];
  const AUD = [0x09, 0xf0];
  const IDR = [0x65, 0x88, 0x84, 0x00, 0x21]; // ends in a non-zero byte, like every NAL unit
  const P = [0x41, 0x9a, 0x02, 0x03];

  it('splits on 3- and 4-byte start codes', () => {
    const b = Uint8Array.from([0, 0, 0, 1, ...AUD, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS, 0, 0, 1, ...IDR, 0]);
    expect(annexBNals(b).map((n) => Array.from(n))).toEqual([AUD, SPS, PPS, IDR]);
  });

  it('becomes length-prefixed frames and an avcC from the stream’s SPS and PPS', () => {
    const key = annexBToAvcc(Uint8Array.from([0, 0, 0, 1, ...AUD, 0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS, 0, 0, 0, 1, ...IDR]));
    expect(Array.from(key.data)).toEqual([0, 0, 0, IDR.length, ...IDR]);
    expect(key.sps.map((n) => Array.from(n))).toEqual([SPS]);
    expect(key.pps.map((n) => Array.from(n))).toEqual([PPS]);
    const delta = annexBToAvcc(Uint8Array.from([0, 0, 0, 1, ...P, 0, 0, 1, ...P]));
    expect(Array.from(delta.data)).toEqual([0, 0, 0, 4, ...P, 0, 0, 0, 4, ...P]);
    expect(Array.from(avcCFrom(key.sps, key.pps))).toEqual([
      1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, SPS.length, ...SPS, 1, 0, PPS.length, ...PPS,
      0xfd, 0xf8, 0xf8, 0, // High profile: 4:2:0, 8-bit
    ]);
    expect(() => avcCFrom([], key.pps)).toThrow();
  });
});
