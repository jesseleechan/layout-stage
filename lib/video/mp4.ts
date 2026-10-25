/* A minimal MP4 (ISO BMFF, ISO/IEC 14496-12 and -15) writer for one H.264 video track, no sound.
   WebCodecs' VideoEncoder hands over the encoded frames ("avc" format: length-prefixed NAL units)
   and the AVCDecoderConfigurationRecord; this lays them out as ftyp + moov + mdat, with the moov first
   so a browser can start playing before the whole file has loaded. Every frame lasts the same time,
   keyframes are listed in stss (seeking), and frames that arrive out of presentation order (B-frames)
   get composition offsets and an edit list. Pure: no DOM, testable in Node. */

export interface Mp4Sample {
  /** One encoded frame, as the encoder output it (length-prefixed NAL units). */
  data: Uint8Array;
  /** A sync sample (IDR frame). */
  key: boolean;
  /** Presentation time in `timescale` units. Samples are in decode order. */
  pts: number;
}

/** Color description for the 'colr' box (ISO/IEC 23091-2 code points). */
export interface Mp4Color {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

export interface Mp4Options {
  width: number;
  height: number;
  /** Media time units per second, e.g. 30000. */
  timescale: number;
  /** Duration of every frame in `timescale` units, e.g. 1000 for 30 fps at 30000. */
  frameDuration: number;
  /** AVCDecoderConfigurationRecord (the encoder's decoderConfig.description). */
  avcC: Uint8Array;
  color?: Mp4Color | null;
}

/** Movie header time units per second. */
const MOVIE_TIMESCALE = 1000;
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/* ---------------- bytes ---------------- */

class Bytes {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 255); return this; }
  u16(v: number) { return this.u8(v >>> 8).u8(v); }
  u24(v: number) { return this.u8(v >>> 16).u8(v >>> 8).u8(v); }
  u32(v: number) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
  i32(v: number) { return this.u32(v >>> 0); }
  zeros(n: number) { for (let i = 0; i < n; i++) this.parts.push(0); return this; }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.parts.push(s.charCodeAt(i) & 255); return this; }
  bytes(b: Uint8Array) { for (let i = 0; i < b.length; i++) this.parts.push(b[i]); return this; }
  done(): Uint8Array { return Uint8Array.from(this.parts); }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = concat(children);
  return concat([new Bytes().u32(8 + body.length).ascii(type).done(), body]);
}

function fullBox(type: string, version: number, flags: number, ...children: Uint8Array[]): Uint8Array {
  return box(type, new Bytes().u8(version).u24(flags).done(), ...children);
}

const matrix = () => {
  const b = new Bytes();
  MATRIX.forEach((v) => b.u32(v));
  return b.done();
};

/* ---------------- boxes ---------------- */

const ftyp = () => box('ftyp', new Bytes().ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41').done());

function mvhd(duration: number): Uint8Array {
  const b = new Bytes().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(duration).u32(0x00010000).u16(0x0100).zeros(10);
  return fullBox('mvhd', 0, 0, b.done(), matrix(), new Bytes().zeros(24).u32(2).done());
}

function tkhd(duration: number, w: number, h: number): Uint8Array {
  const head = new Bytes().u32(0).u32(0).u32(1).u32(0).u32(duration).zeros(8).u16(0).u16(0).u16(0).u16(0).done();
  return fullBox('tkhd', 0, 3, head, matrix(), new Bytes().u32(w * 0x10000).u32(h * 0x10000).done());
}

function edts(duration: number, mediaTime: number): Uint8Array {
  return box('edts', fullBox('elst', 0, 0, new Bytes().u32(1).u32(duration).u32(mediaTime).u16(1).u16(0).done()));
}

function mdhd(timescale: number, duration: number): Uint8Array {
  return fullBox('mdhd', 0, 0, new Bytes().u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4 /* und */).u16(0).done());
}

const hdlr = () => fullBox('hdlr', 0, 0, new Bytes().u32(0).ascii('vide').zeros(12).ascii('VideoHandler').u8(0).done());
const vmhd = () => fullBox('vmhd', 0, 1, new Bytes().u16(0).zeros(6).done());
const dinf = () => box('dinf', fullBox('dref', 0, 0, new Bytes().u32(1).done(), fullBox('url ', 0, 1)));

function colr(c: Mp4Color): Uint8Array {
  return box('colr', new Bytes().ascii('nclx').u16(c.primaries).u16(c.transfer).u16(c.matrix).u8(c.fullRange ? 0x80 : 0).done());
}

function avc1(o: Mp4Options): Uint8Array {
  const head = new Bytes()
    .zeros(6).u16(1) // reserved, data_reference_index
    .u16(0).u16(0).zeros(12) // pre_defined, reserved, pre_defined
    .u16(o.width).u16(o.height)
    .u32(0x00480000).u32(0x00480000) // 72 dpi
    .u32(0).u16(1) // reserved, frame_count
    .zeros(32) // compressorname
    .u16(0x0018).u16(0xffff) // depth, pre_defined = -1
    .done();
  return box('avc1', head, box('avcC', o.avcC), ...(o.color ? [colr(o.color)] : []));
}

/** Run-length entries [count, value] of a list. */
function runs(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

function stbl(samples: Mp4Sample[], o: Mp4Options, offsets: number[] | null, chunkOffset: number): Uint8Array {
  const n = samples.length;
  const b = (fill: (b: Bytes) => void) => { const x = new Bytes(); fill(x); return x.done(); };
  const parts = [
    fullBox('stsd', 0, 0, new Bytes().u32(1).done(), avc1(o)),
    fullBox('stts', 0, 0, new Bytes().u32(1).u32(n).u32(o.frameDuration).done()),
  ];
  if (offsets) {
    const r = runs(offsets);
    parts.push(fullBox('ctts', 0, 0, b((x) => { x.u32(r.length); r.forEach(([c, v]) => x.u32(c).u32(v)); })));
  }
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  if (keys.length < n) parts.push(fullBox('stss', 0, 0, b((x) => { x.u32(keys.length); keys.forEach((k) => x.u32(k)); })));
  parts.push(
    fullBox('stsc', 0, 0, new Bytes().u32(1).u32(1).u32(n).u32(1).done()), // one chunk holds every sample
    fullBox('stsz', 0, 0, b((x) => { x.u32(0).u32(n); samples.forEach((s) => x.u32(s.data.length)); })),
    fullBox('stco', 0, 0, new Bytes().u32(1).u32(chunkOffset).done()),
  );
  return box('stbl', ...parts);
}

/** Decode times are i × frameDuration. When frames come out of presentation order, each gets a
 *  composition offset; offsets are shifted to be ≥ 0 and the edit list starts the movie at the
 *  first presented frame. Returns null offsets when every frame is presented as it is decoded. */
export function compositionOffsets(samples: Pick<Mp4Sample, 'pts'>[], frameDuration: number): { offsets: number[] | null; shift: number } {
  const raw = samples.map((s, i) => s.pts - i * frameDuration);
  if (raw.every((c) => c === 0)) return { offsets: null, shift: 0 };
  const shift = Math.max(0, -Math.min(...raw));
  return { offsets: raw.map((c) => c + shift), shift };
}

function moov(samples: Mp4Sample[], o: Mp4Options, chunkOffset: number): Uint8Array {
  const mediaDuration = samples.length * o.frameDuration;
  const movieDuration = Math.round((mediaDuration * MOVIE_TIMESCALE) / o.timescale);
  const { offsets, shift } = compositionOffsets(samples, o.frameDuration);
  const minPts = Math.min(...samples.map((s) => s.pts));
  return box(
    'moov',
    mvhd(movieDuration),
    box(
      'trak',
      tkhd(movieDuration, o.width, o.height),
      ...(offsets || minPts !== 0 ? [edts(movieDuration, minPts + shift)] : []),
      box('mdia', mdhd(o.timescale, mediaDuration), hdlr(), box('minf', vmhd(), dinf(), stbl(samples, o, offsets, chunkOffset))),
    ),
  );
}

/** The MP4 file, as parts for a Blob (the frames are not copied). */
export function muxMp4(samples: Mp4Sample[], o: Mp4Options): Uint8Array[] {
  if (!samples.length) throw new Error('no frames');
  if (!samples[0].key) throw new Error('the first frame must be a keyframe');
  const head = ftyp();
  const dataSize = samples.reduce((n, s) => n + s.data.length, 0);
  if (dataSize + 8 > 0xffffffff) throw new Error('video too large');
  // The moov's size doesn't depend on the chunk offset it holds: measure it, then write it for real.
  const moovSize = moov(samples, o, 0).length;
  const offset = head.length + moovSize + 8;
  const mdatHead = new Bytes().u32(8 + dataSize).ascii('mdat').done();
  return [head, moov(samples, o, offset), mdatHead, ...samples.map((s) => s.data)];
}

/* ---------------- Annex B ---------------- */
/* An encoder that ignores avc: { format: 'avc' } hands over start-code delimited frames and no
   decoder setup. These turn that into what the MP4 needs: length-prefixed frames and an
   AVCDecoderConfigurationRecord built from the stream's own SPS and PPS. */

/** NAL units of an Annex B stream (start codes 00 00 01 or 00 00 00 01). */
export function annexBNals(b: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) { starts.push(i + 3); i += 2; }
  }
  return starts
    .map((s, k) => {
      let e = k + 1 < starts.length ? starts[k + 1] - 3 : b.length;
      while (e > s && b[e - 1] === 0) e--; // the extra zero of a 4-byte start code, trailing zeros
      return b.subarray(s, e);
    })
    .filter((n) => n.length > 0);
}

/** A frame in length-prefixed form, without parameter sets and access unit delimiters (those go in
 *  the avcC); returns the SPS and PPS it carried. */
export function annexBToAvcc(b: Uint8Array): { data: Uint8Array; sps: Uint8Array[]; pps: Uint8Array[] } {
  const sps: Uint8Array[] = [], pps: Uint8Array[] = [], keep: Uint8Array[] = [];
  for (const n of annexBNals(b)) {
    const type = n[0] & 0x1f;
    if (type === 7) sps.push(n);
    else if (type === 8) pps.push(n);
    else if (type !== 9) keep.push(n);
  }
  const out = new Uint8Array(keep.reduce((t, n) => t + 4 + n.length, 0));
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const n of keep) {
    dv.setUint32(o, n.length);
    out.set(n, o + 4);
    o += 4 + n.length;
  }
  return { data: out, sps, pps };
}

/** AVCDecoderConfigurationRecord (ISO/IEC 14496-15) for 4-byte lengths, 8-bit 4:2:0. */
export function avcCFrom(sps: Uint8Array[], pps: Uint8Array[]): Uint8Array {
  if (!sps.length || !pps.length || sps[0].length < 4) throw new Error('no SPS or PPS');
  const b = new Bytes().u8(1).u8(sps[0][1]).u8(sps[0][2]).u8(sps[0][3]).u8(0xff).u8(0xe0 | sps.length);
  sps.forEach((n) => b.u16(n.length).bytes(n));
  b.u8(pps.length);
  pps.forEach((n) => b.u16(n.length).bytes(n));
  // High profiles also say chroma format and bit depth: 4:2:0, 8-bit, no SPS extensions.
  if ([100, 110, 122, 144].includes(sps[0][1])) b.u8(0xfc | 1).u8(0xf8).u8(0xf8).u8(0);
  return b.done();
}

/* ---------------- colors ---------------- */

const PRIMARIES: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
const MATRIX_CP: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };

/** The 'colr' box values for a WebCodecs VideoColorSpaceInit, or null when it doesn't say enough. */
export function colorFrom(cs: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null } | null | undefined): Mp4Color | null {
  if (!cs) return null;
  const p = cs.primaries ? PRIMARIES[cs.primaries] : undefined;
  const t = cs.transfer ? TRANSFER[cs.transfer] : undefined;
  const m = cs.matrix ? MATRIX_CP[cs.matrix] : undefined;
  if (p == null || t == null || m == null) return null;
  return { primaries: p, transfer: t, matrix: m, fullRange: !!cs.fullRange };
}
