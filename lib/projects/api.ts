/* The browser's side of /api/projects: small JSON calls, and file transfers that never pass a big body
   through a function. Uploads: straight to Vercel Blob with a client token (blob-upload.ts), or in
   4 MB chunks to the local store. Downloads: from the URL the server hands out (a short-lived direct
   Blob URL, or the files route), with progress. Browser only. */
import { UPLOAD_CHUNK, type ProjectFile, type RemoteImage, type RemoteProject, type SyncMode } from './model';

/** No connection (or the browser says it's offline). */
export class OfflineError extends Error {}
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function call(input: string, init?: RequestInit): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError('Offline');
  try {
    return await fetch(input, { cache: 'no-store', ...init });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new OfflineError(e instanceof Error ? e.message : 'Network error');
  }
}

async function fail(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try {
    msg = ((await res.json()) as { message?: string }).message || msg;
  } catch {
    /* not JSON */
  }
  throw new HttpError(res.status, msg);
}

export interface Listing {
  sync: SyncMode;
  projects: (RemoteProject & { thumbUrl: string | null })[];
}

export async function fetchListing(): Promise<Listing> {
  const res = await call('/api/projects');
  if (!res.ok) return fail(res);
  return (await res.json()) as Listing;
}

export interface FileUrls {
  url: string;
  fallback: string;
}
export interface FetchedProject {
  project: ProjectFile;
  files: Record<string, FileUrls>;
}

/** A project from the store, with where its images download from; null when it isn't there. */
export async function fetchProject(id: string): Promise<FetchedProject | null> {
  const res = await call(`/api/projects/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res);
  return (await res.json()) as FetchedProject;
}

export interface PushBody {
  baseRev: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbRev: string | null;
  images: RemoteImage[];
  doc: unknown;
}
export type PushResult = { ok: true; project: RemoteProject } | { ok: false; remote: RemoteProject | null };

export async function pushProject(id: string, body: PushBody, keepalive = false): Promise<PushResult> {
  const res = await call(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive });
  if (res.status === 409) return { ok: false, remote: ((await res.json()) as { remote: RemoteProject | null }).remote };
  if (!res.ok) return fail(res);
  return { ok: true, project: ((await res.json()) as { project: RemoteProject }).project };
}

export async function deleteRemote(id: string): Promise<void> {
  const res = await call(`/api/projects/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await fail(res);
}

/** Uploads one of a project's files (`images/<file>` or `thumb.jpg`). An image already in the store is
 *  left as it is (an image id always names the same bytes). */
export async function uploadFile(
  mode: SyncMode, projectId: string, file: string, blob: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal,
): Promise<void> {
  if (mode === 'blob') {
    const { uploadToBlob } = await import('./blob-upload');
    try {
      await uploadToBlob(`projects/${projectId}/${file}`, blob, onProgress, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError('Offline');
      throw e;
    }
    return;
  }
  const type = blob.type || 'application/octet-stream';
  for (let attempt = 0; attempt < 2; attempt++) {
    let offset = 0;
    let restart = false;
    while (offset < blob.size) {
      const chunk = blob.slice(offset, offset + UPLOAD_CHUNK);
      const res = await call(`/api/projects/${projectId}/files/${file}`, {
        method: 'PUT', body: chunk, signal,
        headers: { 'Content-Type': type, 'X-Upload-Offset': String(offset), 'X-Upload-Total': String(blob.size) },
      });
      if (res.status === 409) {
        restart = true; // another upload of the same file got in between: start over
        break;
      }
      if (!res.ok) await fail(res);
      const r = (await res.json()) as { done: boolean; exists: boolean };
      offset += chunk.size;
      onProgress?.(r.exists ? blob.size : offset);
      if (r.exists || r.done) return;
    }
    if (!restart) return;
  }
  throw new HttpError(409, 'Upload kept being interrupted.');
}

async function fetchBlob(url: string, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await call(url, { signal });
  if (!res.ok) return fail(res);
  const type = res.headers.get('content-type') || '';
  if (!res.body) return new Blob([await res.arrayBuffer()], { type });
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(loaded);
  }
  return new Blob(parts as BlobPart[], { type });
}

/** Downloads a file with progress: from its direct URL, else (that URL unreachable) the files route. */
export async function downloadFile(urls: FileUrls, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<Blob> {
  try {
    return await fetchBlob(urls.url, onProgress, signal);
  } catch (e) {
    if (isAbort(e) || urls.url === urls.fallback || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw e;
    onProgress(0);
    return fetchBlob(urls.fallback, onProgress, signal);
  }
}

/** A thumbnail from the list (null when it can't be had). */
export async function downloadThumb(url: string): Promise<Blob | null> {
  try {
    return await fetchBlob(url, () => {});
  } catch {
    return null;
  }
}
