/* The project store behind /api/projects: a private Vercel Blob store when the deployment has
   BLOB_READ_WRITE_TOKEN (blob-store.ts, the only code that talks to Vercel Blob), else files on disk
   for development and tests (fs-store.ts, PROJECTS_STORE_DIR, default .data/sync). With
   PROJECTS_SYNC=off (even with a Blob store connected), on Vercel without a token, or with
   PROJECTS_STORE_DIR=off, there is no store: projects stay in each browser. Server only. */

export type StoreKind = 'blob' | 'local';

export interface StoredJson<T> {
  data: T;
  /** Version tag for conditional writes. */
  etag: string;
}

/** A conditional write lost to another write. */
export class PreconditionFailed extends Error {
  constructor() {
    super('precondition failed');
  }
}

export interface FileStream {
  body: ReadableStream<Uint8Array>;
  size: number | null;
  type: string;
}

export interface ProjectStore {
  kind: StoreKind;
  /** A JSON file, always the latest version, or null. */
  readJson<T>(path: string): Promise<StoredJson<T> | null>;
  /** Writes a JSON file only if its current version is `ifMatch` (null: only if there is none).
   *  Returns the new version; throws PreconditionFailed otherwise. */
  writeJson(path: string, data: unknown, ifMatch: string | null): Promise<string>;
  /** Pathnames under a prefix. */
  list(prefix: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
  /** A short-lived URL the browser can download the file from directly, so big files never pass
   *  through a function (whose response is capped at 4.5 MB on Vercel). Null: use the files route. */
  directUrl(path: string, fresh: boolean): Promise<string | null>;
  /** The file as a stream (the files route), or null. */
  read(path: string): Promise<FileStream | null>;
}

let pending: Promise<ProjectStore | null> | null = null;

export function storeKind(): StoreKind | null {
  if (process.env.PROJECTS_SYNC === 'off') return null;
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  if (process.env.VERCEL || process.env.PROJECTS_STORE_DIR === 'off') return null;
  return 'local';
}

/** The configured store, or null when sync is off. */
export function projectStore(): Promise<ProjectStore | null> {
  if (!pending) {
    const kind = storeKind();
    pending =
      kind === 'blob' ? import('./blob-store').then((m) => m.blobStore())
      : kind === 'local' ? import('./fs-store').then((m) => m.fsStore(process.env.PROJECTS_STORE_DIR || '.data/sync'))
      : Promise.resolve(null);
  }
  return pending;
}
