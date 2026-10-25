/* The ZIP writer: CRC-32, headers, central directory and end record, read back by a small parser
   written from the spec, and once by real unzip tools when they're installed. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, dosDateTime, zipBlobs, zipBytes, ZipWriter } from '@/lib/zip';

interface Parsed {
  name: string;
  flags: number;
  method: number;
  crc: number;
  data: Uint8Array;
  date: number;
  time: number;
  madeBy: number;
  external: number;
}

/** Reads an archive the way unzip does: end record → central directory → each local header. */
function parseZip(buf: Uint8Array): Parsed[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22; // no archive comment
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  expect(v.getUint16(eocd + 20, true)).toBe(0);
  const n = v.getUint16(eocd + 10, true);
  expect(v.getUint16(eocd + 8, true)).toBe(n);
  const cdSize = v.getUint32(eocd + 12, true), cdOff = v.getUint32(eocd + 16, true);
  expect(cdOff + cdSize).toBe(eocd);
  const out: Parsed[] = [];
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const size = v.getUint32(p + 24, true), csize = v.getUint32(p + 20, true), crc = v.getUint32(p + 16, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(p + 46, p + 46 + nameLen));
    // The local header repeats the same facts.
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 8, true)).toBe(v.getUint16(p + 10, true));
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 18, true)).toBe(csize);
    expect(v.getUint32(local + 22, true)).toBe(size);
    const lName = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
    expect(new TextDecoder().decode(buf.subarray(local + 30, local + 30 + lName))).toBe(name);
    const start = local + 30 + lName + lExtra;
    out.push({
      name, flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true), crc,
      data: buf.subarray(start, start + csize), date: v.getUint16(p + 14, true), time: v.getUint16(p + 12, true),
      madeBy: v.getUint16(p + 4, true), external: v.getUint32(p + 38, true),
    });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const bytes = (s: string) => new TextEncoder().encode(s);
/** Deterministic pseudo-random bytes. */
function noise(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  let a = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0;
    out[i] = a & 255;
  }
  return out;
}

const DATE = new Date(2026, 9, 25, 14, 37, 58);

describe('crc32', () => {
  it('matches the standard check value and known strings', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('can run over chunks', () => {
    const d = noise(10_000);
    expect(crc32(d.subarray(4000), crc32(d.subarray(0, 4000)))).toBe(crc32(d));
  });
});

describe('dosDateTime', () => {
  it('packs local date and time with 2-second resolution', () => {
    const { date, time } = dosDateTime(DATE);
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 25);
    expect(time).toBe((14 << 11) | (37 << 5) | 29);
  });

  it('clamps dates before 1980', () => {
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({ date: (1 << 5) | 1, time: 0 });
  });
});

describe('zip writer', () => {
  const files = [
    { name: '01-layout-stage-etsy-hero-3000x2250.png', data: noise(150_000, 3) },
    { name: 'empty.txt', data: new Uint8Array(0) },
    { name: 'café ☕ – naïve.png', data: bytes('utf-8 name') },
    { name: 'folder/inner.jpg', data: noise(4096, 11) },
  ];

  it('round-trips names, data and CRCs, stored, with UTF-8 names and a fixed date', () => {
    const zip = zipBytes(files, DATE);
    const parsed = parseZip(zip);
    expect(parsed.map((e) => e.name)).toEqual(files.map((f) => f.name));
    const { date, time } = dosDateTime(DATE);
    parsed.forEach((e, i) => {
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(e.crc).toBe(crc32(files[i].data));
      expect(Array.from(e.data)).toEqual(Array.from(files[i].data));
      expect([e.date, e.time]).toEqual([date, time]);
      expect(e.madeBy >> 8).toBe(3); // Unix, so the mode below is honored
      expect(e.external >>> 16).toBe(0o100644);
    });
    // Nothing but headers, data and the directory: sizes add up exactly.
    const expected = files.reduce((n, f) => n + 30 + 46 + 2 * bytes(f.name).length + f.data.length, 22);
    expect(zip.length).toBe(expected);
  });

  it('writes a valid empty archive', () => {
    const zip = zipBytes([]);
    expect(zip.length).toBe(22);
    expect(parseZip(zip)).toEqual([]);
  });

  it('refuses duplicate, absolute and parent-relative names', () => {
    const w = new ZipWriter();
    w.add('a.png', bytes('a'));
    expect(() => w.add('a.png', bytes('b'))).toThrow(/duplicate/);
    expect(() => w.add('/etc/a.png', bytes('b'))).toThrow(/bad/);
    expect(() => w.add('x/../../a.png', bytes('b'))).toThrow(/bad/);
    expect(() => w.add('', bytes('b'))).toThrow(/bad/);
  });

  it('zipBlobs gives the same bytes as zipBytes', async () => {
    const blob = await zipBlobs(files.map((f) => ({ name: f.name, blob: new Blob([f.data as Uint8Array<ArrayBuffer>]) })), DATE);
    expect(blob.type).toBe('application/zip');
    const got = new Uint8Array(await blob.arrayBuffer());
    expect(Buffer.from(got).equals(Buffer.from(zipBytes(files, DATE)))).toBe(true);
  });

  const python = spawnSync('python3', ['--version']).status === 0;
  const unzip = spawnSync('unzip', ['-v']).status === 0;

  it.skipIf(!python && !unzip)('passes real unzip tools (python zipfile, unzip -t)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const path = join(dir, 'test.zip');
      writeFileSync(path, zipBytes(files, DATE));
      if (python) {
        const script = [
          'import sys, zipfile, zlib',
          'z = zipfile.ZipFile(sys.argv[1])',
          'assert z.testzip() is None',
          'print("\\n".join(f"{i.filename}|{i.file_size}|{i.compress_type}|{zlib.crc32(z.read(i))}" for i in z.infolist()))',
        ].join('\n');
        const r = spawnSync('python3', ['-I', '-c', script, path], { encoding: 'utf8' });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout.trim().split('\n')).toEqual(files.map((f) => `${f.name}|${f.data.length}|0|${crc32(f.data)}`));
      }
      if (unzip) {
        const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/No errors detected/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
