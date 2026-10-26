/* What the /api/projects routes do, on any ProjectStore: list, read, write (with conflict checks) and
   delete projects, keeping projects/index.json in step. Store-agnostic, so it's unit-tested against
   the local store. Server only.

   Operation budget: on Vercel Hobby a Blob store includes 2,000 advanced operations (uploads, lists)
   and 10,000 simple ones (uncached reads) a month, and stops working until the month is over when
   they run out. So: a project write is two uploads (project.json, index.json) and two reads; the list
   is one read; nothing here lists the store except a delete and rebuilding a lost index. */
import {
  cleanName, INDEX_PATH, metaOf, mergeImages, PROJECT_ID_RE, projectPath, projectPrefix, revisionOf, sanitizeImages, sanitizeRemote,
  type ProjectFile, type RemoteImage, type RemoteProject,
} from '../model';
import { PreconditionFailed, type ProjectStore } from './store';

interface IndexFile {
  v: 1;
  projects: RemoteProject[];
}

/** Largest project.json accepted (a canvas is a few KB). */
export const MAX_PROJECT_BYTES = 1024 * 1024;

export class BadRequest extends Error {}

const cleanIndex = (raw: unknown): RemoteProject[] => {
  const list = (raw as Partial<IndexFile> | null)?.projects;
  return Array.isArray(list) ? list.map(sanitizeRemote).filter((p): p is RemoteProject => !!p) : [];
};

/** Rebuilds a missing index from the project files (one list, one read per project). */
async function rebuild(store: ProjectStore): Promise<RemoteProject[]> {
  const paths = (await store.list('projects/')).filter((p) => /^projects\/[^/]+\/project\.json$/.test(p));
  const files = await Promise.all(paths.map((p) => store.readJson<ProjectFile>(p).catch(() => null)));
  return files.map((f) => f && sanitizeRemote(f.data)).filter((p): p is RemoteProject => !!p);
}

/** Changes the index, retrying when another write got there first. `change` returns its argument
 *  itself when there's nothing to change. */
async function updateIndex(store: ProjectStore, change: (list: RemoteProject[]) => RemoteProject[]): Promise<RemoteProject[]> {
  for (let attempt = 0; ; attempt++) {
    const cur = await store.readJson<IndexFile>(INDEX_PATH);
    const before = cur ? cleanIndex(cur.data) : await rebuild(store);
    const next = change(before);
    if (next === before && cur) return before; // nothing to change
    try {
      await store.writeJson(INDEX_PATH, { v: 1, projects: next } satisfies IndexFile, cur?.etag ?? null);
      return next;
    } catch (e) {
      if (!(e instanceof PreconditionFailed) || attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
}

export async function listProjects(store: ProjectStore): Promise<RemoteProject[]> {
  const cur = await store.readJson<IndexFile>(INDEX_PATH);
  if (cur) return cleanIndex(cur.data);
  const found = await rebuild(store);
  try {
    await store.writeJson(INDEX_PATH, { v: 1, projects: found } satisfies IndexFile, null);
  } catch {
    /* another request wrote it first */
  }
  return found;
}

export async function readProject(store: ProjectStore, id: string): Promise<ProjectFile | null> {
  if (!PROJECT_ID_RE.test(id)) return null;
  const f = await store.readJson<ProjectFile>(projectPath(id));
  const meta = f && sanitizeRemote(f.data);
  if (!f || !meta || meta.id !== id) return null;
  return { v: 1, ...meta, images: sanitizeImages(f.data.images), doc: f.data.doc };
}

/** What a device sends to save a project. */
export interface ProjectWrite {
  /** The store revision the device's copy is based on; null for a project it has never synced. */
  baseRev: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbRev: string | null;
  images: RemoteImage[];
  doc: unknown;
}

export function parseWrite(raw: unknown): ProjectWrite {
  const r = raw as Partial<ProjectWrite> | null;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!r || typeof r !== 'object') throw new BadRequest('Expected a project.');
  if (!(r.baseRev === null || (typeof r.baseRev === 'string' && r.baseRev.length <= 64))) throw new BadRequest('Bad base revision.');
  const name = typeof r.name === 'string' ? cleanName(r.name) : '';
  if (!name) throw new BadRequest('A project needs a name.');
  if (!ok(r.createdAt) || !ok(r.updatedAt)) throw new BadRequest('Bad times.');
  if (!(r.thumbRev == null || (typeof r.thumbRev === 'string' && /^\d{1,16}$/.test(r.thumbRev)))) throw new BadRequest('Bad thumbnail stamp.');
  const doc = r.doc as { W?: unknown; H?: unknown; slots?: unknown } | null;
  if (!doc || typeof doc !== 'object' || typeof doc.W !== 'number' || typeof doc.H !== 'number' || !Array.isArray(doc.slots)) throw new BadRequest('Expected a canvas.');
  return { baseRev: r.baseRev, name, createdAt: r.createdAt!, updatedAt: r.updatedAt!, thumbRev: r.thumbRev ?? null, images: sanitizeImages(r.images), doc };
}

export type WriteResult = { ok: true; project: RemoteProject } | { ok: false; remote: RemoteProject | null };

/** Saves a project unless the store's copy changed since the device's base revision (then the
 *  store's copy is returned, or null when it was deleted). */
export async function writeProject(store: ProjectStore, id: string, w: ProjectWrite): Promise<WriteResult> {
  if (!PROJECT_ID_RE.test(id)) throw new BadRequest('Bad project id.');
  const rev = await revisionOf(w.name, w.doc);
  for (let attempt = 0; ; attempt++) {
    const cur = await store.readJson<ProjectFile>(projectPath(id));
    const curMeta = cur && sanitizeRemote(cur.data);
    const curRev = curMeta?.rev ?? null;
    if (curRev !== w.baseRev && curRev !== rev) return { ok: false, remote: curMeta };
    const file: ProjectFile = {
      v: 1, id, name: w.name, createdAt: curMeta?.createdAt ?? w.createdAt, updatedAt: w.updatedAt, rev,
      thumbRev: w.thumbRev ?? curMeta?.thumbRev ?? null,
      images: mergeImages(sanitizeImages(cur?.data.images), w.images),
      doc: w.doc,
    };
    if (JSON.stringify(file).length > MAX_PROJECT_BYTES) throw new BadRequest('That project is too big to sync.');
    try {
      await store.writeJson(projectPath(id), file, cur?.etag ?? null);
    } catch (e) {
      if (e instanceof PreconditionFailed && attempt < 2) continue; // re-read: maybe identical, maybe a conflict
      throw e;
    }
    const meta = metaOf(file);
    await updateIndex(store, (list) => [meta, ...list.filter((p) => p.id !== id)]);
    return { ok: true, project: meta };
  }
}

/** Deletes a project: off the list first, then every file under its folder. */
export async function deleteProject(store: ProjectStore, id: string): Promise<void> {
  if (!PROJECT_ID_RE.test(id)) throw new BadRequest('Bad project id.');
  await updateIndex(store, (list) => (list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : list));
  const paths = await store.list(projectPrefix(id));
  if (paths.length) await store.remove(paths);
}
