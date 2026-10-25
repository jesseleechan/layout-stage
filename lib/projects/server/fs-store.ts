/* The local project store: the Blob store's pathnames as files under a folder (PROJECTS_STORE_DIR,
   default .data/sync, gitignored), for development and tests without a Blob token. Same interface
   and the same rules as the Blob store: conditional JSON writes, and uploads that arrive in chunks
   under Vercel's 4.5 MB body limit, so nothing works here that couldn't work hosted. One Node process
   at a time (writes are serialized per path in memory). Server only. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, rmdir, stat, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileType } from '../model';
import { PreconditionFailed, type FileStream, type ProjectStore, type StoredJson } from './store';

const SAFE = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._/-]+$/;

const etagOf = (b: Buffer | string) => createHash('sha256').update(b).digest('hex').slice(0, 32);

export type ChunkResult = 'partial' | 'done' | 'exists';

export class OffsetMismatch extends Error {
  constructor(readonly have: number) {
    super('offset mismatch');
  }
}

export interface FsStore extends ProjectStore {
  /** Appends one chunk of an upload (`offset` must be what has arrived so far); the file appears
   *  once all `total` bytes are in. An existing file is kept unless `overwrite`. */
  writeChunk(p: string, offset: number, total: number, bytes: Uint8Array, overwrite: boolean): Promise<ChunkResult>;
}

export function fsStore(dir: string): FsStore {
  const root = path.resolve(dir);
  const file = (p: string) => {
    if (!SAFE.test(p)) throw new Error(`bad path ${p}`);
    return path.join(root, ...p.split('/'));
  };
  const locks = new Map<string, Promise<unknown>>();
  /** Runs `fn` after any earlier work on the same path. */
  const locked = <T>(p: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(p) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(p, tail);
    void tail.then(() => locks.get(p) === tail && locks.delete(p));
    return run;
  };
  const readBytes = async (p: string): Promise<Buffer | null> => {
    try {
      return await readFile(file(p));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  };
  /** Writes through a temporary file, so a reader never sees half a file. */
  const atomicWrite = async (p: string, data: string | Buffer) => {
    const f = file(p);
    await mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, f);
  };
  const exists = async (f: string) => {
    try {
      await stat(f);
      return true;
    } catch {
      return false;
    }
  };

  return {
    kind: 'local',

    async readJson<T>(p: string): Promise<StoredJson<T> | null> {
      const b = await readBytes(p);
      return b ? { data: JSON.parse(b.toString('utf8')) as T, etag: etagOf(b) } : null;
    },

    writeJson(p, data, ifMatch) {
      return locked(p, async () => {
        const cur = await readBytes(p);
        if ((cur ? etagOf(cur) : null) !== ifMatch) throw new PreconditionFailed();
        const text = JSON.stringify(data);
        await atomicWrite(p, text);
        return etagOf(text);
      });
    },

    async list(prefix) {
      const out: string[] = [];
      const base = prefix.slice(0, prefix.lastIndexOf('/') + 1);
      const walk = async (rel: string) => {
        let entries;
        try {
          entries = await readdir(path.join(root, ...rel.split('/').filter(Boolean)), { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = rel + e.name;
          if (e.isDirectory()) await walk(p + '/');
          else if (p.startsWith(prefix) && !p.endsWith('.tmp')) out.push(p);
        }
      };
      await walk(base);
      return out.sort();
    },

    async remove(paths) {
      await Promise.all(paths.map((p) => locked(p, () => rm(file(p), { force: true }))));
      // Tidy the folders this left empty, deepest first.
      const dirs = [...new Set(paths.map((p) => path.dirname(file(p))))].sort((a, b) => b.length - a.length);
      for (const d of dirs) {
        for (let cur = d; cur.startsWith(root + path.sep) && cur !== root; cur = path.dirname(cur)) {
          try {
            await rmdir(cur); // only succeeds when empty
          } catch {
            break;
          }
        }
      }
    },

    async directUrl() {
      return null;
    },

    async read(p): Promise<FileStream | null> {
      const f = file(p);
      try {
        const s = await stat(f);
        if (!s.isFile()) return null;
        const body = Readable.toWeb(createReadStream(f)) as unknown as ReadableStream<Uint8Array>;
        return { body, size: s.size, type: fileType(p.slice(p.lastIndexOf('/') + 1)) };
      } catch {
        return null;
      }
    },

    writeChunk(p, offset, total, bytes, overwrite) {
      return locked(p, async () => {
        const f = file(p);
        if (!overwrite && (await exists(f))) return 'exists';
        const part = `${f}.part`;
        await mkdir(path.dirname(f), { recursive: true });
        if (offset === 0) await writeFile(part, '');
        else {
          let have = -1;
          try {
            have = (await stat(part)).size;
          } catch {
            /* no upload in progress */
          }
          if (have !== offset) throw new OffsetMismatch(Math.max(0, have));
        }
        if (offset + bytes.byteLength > total) {
          await truncate(part, 0).catch(() => undefined);
          throw new OffsetMismatch(0);
        }
        await appendFile(part, bytes);
        if (offset + bytes.byteLength < total) return 'partial';
        await rename(part, f);
        return 'done';
      });
    },
  };
}
