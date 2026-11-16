/* A small ZIP writer for "Save all (.zip)", and a reader for archives this writer made. Entries are
   stored, not compressed: PNG and JPG are compressed already, so deflate would only cost time. Names
   are UTF-8 (general-purpose flag bit 11). No ZIP64, so the archive stays under 4 GiB and 65,535
   entries, which a listing set never nears.

   Streaming-friendly: ZipWriter hands back each entry's local header to place in front of its data,
   so a caller can keep each file as the Blob it already has (zipBlobs) and only reads one file at a
   time to compute its CRC. Pure apart from zipBlobs and readStoredZip, which need Blob. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3, the one ZIP uses). Pass the previous result as `crc` to continue a running one. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, local time, 2-second resolution, clamped to the format's 1980–2107 range. */
export function dosDateTime(d: Date): { date: number; time: number } {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  const early = d.getFullYear() < 1980;
  return {
    date: ((y - 1980) << 9) | ((early ? 1 : d.getMonth() + 1) << 5) | (early ? 1 : d.getDate()),
    time: early ? 0 : (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

const UTF8 = 0x0800; // general-purpose bit 11: the name is UTF-8
const VERSION_NEEDED = 10; // 1.0: stored entries
const VERSION_MADE_BY = (3 << 8) | 20; // Unix, spec 2.0, so the external attributes below are Unix modes
const FILE_MODE = (0o100644 << 16) >>> 0; // regular file, rw-r--r--
const MAX_U32 = 0xffffffff;

interface Central {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

export class ZipWriter {
  private entries: Central[] = [];
  private names = new Set<string>();
  private offset = 0;
  private dos: { date: number; time: number };

  /** `date` is the modification time written for every entry. */
  constructor(date: Date = new Date()) {
    this.dos = dosDateTime(date);
  }

  /** The local file header for an entry of `size` bytes with checksum `crc`. The entry's data must
   *  follow it directly, before the next header. */
  header(name: string, size: number, crc: number): Uint8Array<ArrayBuffer> {
    if (!name || name.startsWith('/') || name.split('/').includes('..')) throw new Error(`bad zip entry name: ${name}`);
    if (this.names.has(name)) throw new Error(`duplicate zip entry: ${name}`);
    if (this.entries.length >= 0xffff) throw new Error('too many zip entries');
    const bytes = new TextEncoder().encode(name);
    if (bytes.length > 0xffff) throw new Error('zip entry name too long');
    if (size > MAX_U32 || this.offset + 30 + bytes.length + size > MAX_U32) throw new Error('zip too large');
    const h = new Uint8Array(30 + bytes.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true); // local file header signature
    v.setUint16(4, VERSION_NEEDED, true);
    v.setUint16(6, UTF8, true);
    v.setUint16(8, 0, true); // method: stored
    v.setUint16(10, this.dos.time, true);
    v.setUint16(12, this.dos.date, true);
    v.setUint32(14, crc >>> 0, true);
    v.setUint32(18, size, true); // compressed size
    v.setUint32(22, size, true); // uncompressed size
    v.setUint16(26, bytes.length, true);
    v.setUint16(28, 0, true); // extra field length
    h.set(bytes, 30);
    this.names.add(name);
    this.entries.push({ name: bytes, crc: crc >>> 0, size, offset: this.offset });
    this.offset += h.length + size;
    return h;
  }

  /** Header and data for an entry held in memory. */
  add(name: string, data: Uint8Array): [Uint8Array<ArrayBuffer>, Uint8Array] {
    return [this.header(name, data.length, crc32(data)), data];
  }

  /** The central directory and end-of-central-directory record. Call once, after the last entry. */
  end(): Uint8Array<ArrayBuffer> {
    const cdSize = this.entries.reduce((n, e) => n + 46 + e.name.length, 0);
    if (this.offset + cdSize + 22 > MAX_U32) throw new Error('zip too large');
    const out = new Uint8Array(cdSize + 22);
    const v = new DataView(out.buffer);
    let p = 0;
    for (const e of this.entries) {
      v.setUint32(p, 0x02014b50, true); // central directory header signature
      v.setUint16(p + 4, VERSION_MADE_BY, true);
      v.setUint16(p + 6, VERSION_NEEDED, true);
      v.setUint16(p + 8, UTF8, true);
      v.setUint16(p + 10, 0, true); // stored
      v.setUint16(p + 12, this.dos.time, true);
      v.setUint16(p + 14, this.dos.date, true);
      v.setUint32(p + 16, e.crc, true);
      v.setUint32(p + 20, e.size, true);
      v.setUint32(p + 24, e.size, true);
      v.setUint16(p + 28, e.name.length, true);
      v.setUint16(p + 30, 0, true); // extra
      v.setUint16(p + 32, 0, true); // comment
      v.setUint16(p + 34, 0, true); // disk number start
      v.setUint16(p + 36, 0, true); // internal attributes
      v.setUint32(p + 38, FILE_MODE, true); // external attributes
      v.setUint32(p + 42, e.offset, true); // local header offset
      out.set(e.name, p + 46);
      p += 46 + e.name.length;
    }
    v.setUint32(p, 0x06054b50, true); // end of central directory signature
    v.setUint16(p + 4, 0, true); // this disk
    v.setUint16(p + 6, 0, true); // disk with the central directory
    v.setUint16(p + 8, this.entries.length, true);
    v.setUint16(p + 10, this.entries.length, true);
    v.setUint32(p + 12, cdSize, true);
    v.setUint32(p + 16, this.offset, true); // central directory offset
    v.setUint16(p + 20, 0, true); // comment length
    return out;
  }
}

/** A whole archive in memory, from in-memory files (tests, small archives). */
export function zipBytes(files: { name: string; data: Uint8Array }[], date?: Date): Uint8Array<ArrayBuffer> {
  const w = new ZipWriter(date);
  const parts = files.flatMap((f) => w.add(f.name, f.data));
  parts.push(w.end());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A ZIP Blob from Blobs. Reads one file at a time for its CRC; the archive references the original
 *  Blobs rather than copying them into one buffer. */
export async function zipBlobs(files: { name: string; blob: Blob }[], date?: Date): Promise<Blob> {
  const w = new ZipWriter(date);
  const parts: BlobPart[] = [];
  for (const f of files) {
    const crc = crc32(new Uint8Array(await f.blob.arrayBuffer()));
    parts.push(w.header(f.name, f.blob.size, crc), f.blob);
  }
  parts.push(w.end());
  return new Blob(parts, { type: 'application/zip' });
}

/** The entries of a ZIP whose files are all stored (this module's own archives): each as a slice of
 *  `file`, nothing copied. Throws on anything else: a compressed or encrypted entry, ZIP64, a comment,
 *  a name that is absolute or climbs out, or sizes that don't fit the file. */
export async function readStoredZip(file: Blob): Promise<{ name: string; blob: Blob }[]> {
  if (file.size < 22) throw new Error('not a zip');
  const eocd = new DataView(await file.slice(file.size - 22, file.size).arrayBuffer());
  if (eocd.getUint32(0, true) !== 0x06054b50 || eocd.getUint16(20, true) !== 0) throw new Error('not a zip');
  const count = eocd.getUint16(10, true);
  if (eocd.getUint16(8, true) !== count) throw new Error('not a zip');
  const cdSize = eocd.getUint32(12, true);
  const cdOff = eocd.getUint32(16, true);
  if (cdOff + cdSize + 22 !== file.size) throw new Error('not a zip');

  const cdBuf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer();
  const cdBytes = new Uint8Array(cdBuf);
  const cd = new DataView(cdBuf);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const records: { name: string; size: number; local: number }[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdBytes.length || cd.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip record');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    if ((flags & ~UTF8) !== 0 || method !== 0) throw new Error('unsupported zip entry');
    const csize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    if (csize !== size) throw new Error('bad zip entry size');
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > cdBytes.length) throw new Error('bad zip record');
    const name = decoder.decode(cdBytes.subarray(p + 46, p + 46 + nameLen));
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error(`bad zip entry name: ${name}`);
    }
    const local = cd.getUint32(p + 42, true);
    records.push({ name, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== cdBytes.length) throw new Error('bad zip directory');

  const entries: { name: string; blob: Blob }[] = [];
  for (const r of records) {
    if (r.local + 30 > cdOff) throw new Error('bad zip local header');
    const lh = new DataView(await file.slice(r.local, r.local + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('bad zip local header');
    const start = r.local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (start + r.size > cdOff) throw new Error('bad zip entry bounds');
    entries.push({ name: r.name, blob: file.slice(start, start + r.size) });
  }
  return entries;
}

