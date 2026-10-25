/* Projects: named canvases, each a composition plus its images, kept in this browser (lib/projects/
   local.ts) and synced across devices through the server's project store (Vercel Blob when hosted,
   files under .data/ in development: lib/projects/server/). Pure, so it's unit-tested and shared by the
   browser and the API routes.

   Store layout (pathnames in the Blob store, or files under PROJECTS_STORE_DIR):
     projects/index.json                      the list: id, name, times, rev, thumbnail stamp
     projects/<id>/project.json               the composition, its image list and the same fields
     projects/<id>/thumb.jpg                  a small render of the canvas, for the list
     projects/<id>/images/<imageId>.<ext>     the images, byte for byte as stored in the browser

   Sync is last writer wins per project, decided by revisions: `rev` is a hash of the name and canvas
   that the server computes on every write, and each device remembers the rev its copy is based on.
   Only one side changed: that side wins. Both changed: both are kept (planSync's 'fork'). */
import type { Composition } from '../model';

/* ---------------- ids and file names ---------------- */

export const PROJECT_ID_RE = /^prj_[A-Za-z0-9-]{6,64}$/;
/** Image ids as lib/images.ts makes them: img_ + a UUID (or a time + random fallback). */
export const IMAGE_ID_RE = /^img_[A-Za-z0-9-]{4,80}$/;
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
};
const EXT_TYPE: Record<string, string> = Object.fromEntries(Object.entries(IMAGE_EXT).map(([t, e]) => [e, t]));
export const IMAGE_FILE_RE = /^(img_[A-Za-z0-9-]{4,80})\.(png|jpg|webp|gif|avif|bmp|svg|img)$/;

export const newProjectId = () =>
  'prj_' + (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));

/** The file an image is stored as: its id plus an extension for its type. */
export function imageFileName(imageId: string, type: string): string {
  return `${imageId}.${IMAGE_EXT[type] ?? 'img'}`;
}
/** The image id a file name stores, or null. */
export function imageIdOf(fileName: string): string | null {
  return IMAGE_FILE_RE.exec(fileName)?.[1] ?? null;
}
/** The content type to serve a stored file with. */
export function fileType(fileName: string): string {
  if (fileName === 'thumb.jpg') return 'image/jpeg';
  return EXT_TYPE[fileName.slice(fileName.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}

export const INDEX_PATH = 'projects/index.json';
export const projectPrefix = (id: string) => `projects/${id}/`;
export const projectPath = (id: string) => `projects/${id}/project.json`;
export const thumbPath = (id: string) => `projects/${id}/thumb.jpg`;
export const imagePath = (id: string, fileName: string) => `projects/${id}/images/${fileName}`;

/** Most bytes one image may have in the store (stored images are at most 33 MP; see image-sizing). */
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
/** Request bodies stay under Vercel's 4.5 MB function limit; the local store's uploads use chunks of this. */
export const UPLOAD_CHUNK = 4 * 1024 * 1024;

export interface UploadRule {
  projectId: string;
  /** Path inside the project folder: images/<file> or thumb.jpg. */
  file: string;
  maxBytes: number;
  contentTypes: string[];
  overwrite: boolean;
}

/** What may be uploaded to a store pathname, or null when nothing may: only a project's images
 *  (never overwritten: an image id always names the same bytes) and its thumbnail. */
export function uploadRule(pathname: string): UploadRule | null {
  const m = /^projects\/([^/]+)\/(images\/[^/]+|thumb\.jpg)$/.exec(pathname);
  if (!m || !PROJECT_ID_RE.test(m[1])) return null;
  if (m[2] === 'thumb.jpg') return { projectId: m[1], file: m[2], maxBytes: MAX_THUMB_BYTES, contentTypes: ['image/jpeg'], overwrite: true };
  if (!IMAGE_FILE_RE.test(m[2].slice('images/'.length))) return null;
  return { projectId: m[1], file: m[2], maxBytes: MAX_IMAGE_BYTES, contentTypes: ['image/*'], overwrite: false };
}

/* ---------------- records ---------------- */

/** An image file in the store. */
export interface RemoteImage {
  name: string;
  size: number;
}

/** A project as the store lists it (projects/index.json). */
export interface RemoteProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  rev: string;
  /** The uploaded thumbnail's stamp (when it was made, ms, as a string); null: none. */
  thumbRev: string | null;
}

/** projects/<id>/project.json */
export interface ProjectFile extends RemoteProject {
  v: 1;
  images: RemoteImage[];
  doc: unknown;
}

/** A project as this browser knows it (lib/projects/local.ts). */
export interface LocalProject {
  id: string;
  name: string;
  createdAt: number;
  /** Last edit, ms: here, or on the device that made it once pulled. */
  updatedAt: number;
  /** The store revision the local canvas is based on; null: never synced. */
  rev: string | null;
  /** Edited on this device since it was last synced. */
  dirty: boolean;
  /** Listed from another device: the canvas isn't on this device yet. */
  stub?: boolean;
  /** Never synced or renamed, and the canvas is still the default one: not uploaded until it changes
   *  (every new browser starts with one). */
  blank?: boolean;
  /** Image files known to be in the store. */
  remoteImages?: RemoteImage[];
  /** When the local thumbnail was made (ms); absent: none. */
  thumbAt?: number;
  /** The store's thumbnail stamp as last seen or uploaded here. */
  thumbRev?: string | null;
  /** When this device last uploaded the thumbnail (ms). */
  thumbUploadedAt?: number;
}

export const metaOf = (p: RemoteProject): RemoteProject => ({
  id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, rev: p.rev, thumbRev: p.thumbRev ?? null,
});

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A store listing entry, or null when it's unusable. */
export function sanitizeRemote(raw: unknown): RemoteProject | null {
  const r = raw as Partial<RemoteProject> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !PROJECT_ID_RE.test(r.id)) return null;
  if (typeof r.name !== 'string' || typeof r.rev !== 'string' || !num(r.createdAt) || !num(r.updatedAt)) return null;
  return { id: r.id, name: cleanName(r.name) || 'Untitled', createdAt: r.createdAt, updatedAt: r.updatedAt, rev: r.rev, thumbRev: typeof r.thumbRev === 'string' ? r.thumbRev : null };
}

export function sanitizeImages(raw: unknown): RemoteImage[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, RemoteImage>();
  for (const i of raw.slice(0, 2000)) {
    if (i && typeof i.name === 'string' && IMAGE_FILE_RE.test(i.name) && num(i.size) && i.size >= 0) out.set(i.name, { name: i.name, size: i.size });
  }
  return [...out.values()];
}

/** Both lists, by file name (the later list's size wins). */
export function mergeImages(a: RemoteImage[] = [], b: RemoteImage[] = []): RemoteImage[] {
  const m = new Map<string, RemoteImage>();
  for (const i of [...a, ...b]) m.set(i.name, i);
  return [...m.values()];
}

/** Every image id a canvas refers to: every layout slot (hidden ones come back with more layouts or
 *  undo), the background photo, the logo and the media gallery. */
export function referencedImageIds(d: Composition): string[] {
  const ids = new Set(d.slots.map((s) => s.imageId));
  if (d.background.imageId) ids.add(d.background.imageId);
  const wm = d.overlays?.watermark;
  if (wm?.imageId) ids.add(wm.imageId);
  for (const m of d.media ?? []) ids.add(m.imageId);
  return [...ids];
}

/** The images sync carries: stored ones (samples are drawn, never stored). */
export function projectImageIds(d: Composition): string[] {
  return referencedImageIds(d).filter((id) => IMAGE_ID_RE.test(id));
}

/* ---------------- names ---------------- */

export const MAX_NAME = 80;
export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
}

/** "Untitled N", one past the highest N in use. */
export function untitledName(names: string[]): string {
  let n = 0;
  for (const name of names) {
    const m = /^Untitled (\d+)$/.exec(name);
    if (m) n = Math.max(n, +m[1]);
  }
  return `Untitled ${n + 1}`;
}

function unique(base: string, names: string[], more: (k: number) => string): string {
  const taken = new Set(names);
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(more(k))) return more(k);
}

/** "Name copy", then "Name copy 2", … */
export function copyName(name: string, names: string[]): string {
  const base = cleanName(`${name} copy`);
  return unique(base, names, (k) => cleanName(`${name} copy ${k}`));
}

/** The name the local copy keeps when the same project changed here and on another device. */
export function deviceCopyName(name: string, names: string[]): string {
  const base = cleanName(`${name} (this device)`);
  return unique(base, names, (k) => cleanName(`${name} (this device ${k})`));
}

/* ---------------- planning a sync ---------------- */

export type SyncAction =
  /** Upload the local copy. */
  | { kind: 'push'; id: string }
  /** The store's copy is newer and this one is unchanged: replace the local copy. */
  | { kind: 'pull'; id: string; remote: RemoteProject }
  /** Not on this device yet, changed elsewhere: update the listing. */
  | { kind: 'refresh'; id: string; remote: RemoteProject }
  /** New from another device: list it (the canvas downloads when it's opened). */
  | { kind: 'adopt'; remote: RemoteProject }
  /** Changed here and elsewhere: keep this device's copy as a new project, take the store's. */
  | { kind: 'fork'; id: string; remote: RemoteProject }
  /** Deleted elsewhere, unchanged here: delete it here too. */
  | { kind: 'drop'; id: string }
  /** Deleted elsewhere, changed here: keep it and upload it again. */
  | { kind: 'recreate'; id: string }
  /** Deleted here: delete it from the store. */
  | { kind: 'delete'; id: string }
  /** The store has a newer thumbnail. */
  | { kind: 'thumb'; id: string; remote: RemoteProject };

const listingChanged = (l: LocalProject, r: RemoteProject) => l.rev !== r.rev || l.name !== r.name || l.updatedAt !== r.updatedAt;

/** What to do to bring this device and the store together. Deletes made here come first, then each
 *  local project, then projects new to this device. */
export function planSync(local: LocalProject[], remote: RemoteProject[], pendingDeletes: string[] = []): SyncAction[] {
  const out: SyncAction[] = [];
  const gone = new Set(pendingDeletes);
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const id of gone) if (byId.has(id)) out.push({ kind: 'delete', id });
  for (const l of local) {
    if (gone.has(l.id)) continue;
    const r = byId.get(l.id);
    if (!r) {
      if (l.rev == null) {
        if (!l.blank) out.push({ kind: 'push', id: l.id });
      } else if (l.dirty && !l.stub) out.push({ kind: 'recreate', id: l.id });
      else out.push({ kind: 'drop', id: l.id });
      continue;
    }
    if (l.stub) {
      if (listingChanged(l, r)) out.push({ kind: 'refresh', id: l.id, remote: r });
    } else if (l.rev === r.rev) {
      if (l.dirty) out.push({ kind: 'push', id: l.id });
    } else if (l.dirty || l.rev == null) {
      out.push({ kind: 'fork', id: l.id, remote: r });
      continue;
    } else {
      out.push({ kind: 'pull', id: l.id, remote: r });
      continue; // a pull brings the thumbnail along
    }
    if (thumbNewer(l, r)) out.push({ kind: 'thumb', id: l.id, remote: r });
  }
  const known = new Set(local.map((l) => l.id));
  for (const r of remote) if (!known.has(r.id) && !gone.has(r.id)) out.push({ kind: 'adopt', remote: r });
  return out;
}

/** The store's thumbnail is newer than this device's (and this device isn't about to upload its own). */
export function thumbNewer(l: LocalProject, r: RemoteProject): boolean {
  if (r.thumbRev == null || r.thumbRev === l.thumbRev || l.dirty) return false;
  return Number(r.thumbRev) > (l.thumbAt ?? 0);
}

/** Thumbnails are uploaded at most every 15 minutes while a project is being edited (each upload is
 *  one of the Blob store's monthly operations), and whenever it's left with a newer one. */
export const THUMB_UPLOAD_GAP = 15 * 60_000;
export function thumbDue(p: LocalProject, now: number, leaving: boolean): boolean {
  if (!p.thumbAt) return false;
  if (p.thumbRev != null && Number(p.thumbRev) >= p.thumbAt) return false;
  return leaving || !p.thumbUploadedAt || now - p.thumbUploadedAt >= THUMB_UPLOAD_GAP;
}

/* ---------------- status ---------------- */

export type SyncMode = 'blob' | 'local' | 'off';
export type SyncPhase = 'unknown' | 'idle' | 'syncing' | 'offline' | 'error';
export type StatusKey = 'off' | 'local' | 'syncing' | 'synced' | 'offline';

export interface StatusView {
  key: StatusKey;
  label: string;
  /** Longer explanation (tooltip, the projects sheet). */
  detail: string;
}

/** What the projects control says about sync. */
export function syncStatus(mode: SyncMode | null, phase: SyncPhase, pending: boolean): StatusView {
  if (mode === 'off') return { key: 'off', label: 'Sync off', detail: 'Sync is off on this server, so projects are saved in this browser only.' };
  if (phase === 'offline') return { key: 'offline', label: 'Offline', detail: 'Saved on this device. Changes sync when you’re back online.' };
  if (phase === 'syncing') return { key: 'syncing', label: 'Syncing…', detail: 'Syncing your projects with your other devices.' };
  if (phase === 'error') return { key: 'local', label: 'Saved on this device', detail: 'Saved on this device. Couldn’t sync just now, trying again soon.' };
  if (pending || mode == null || phase === 'unknown') return { key: 'local', label: 'Saved on this device', detail: 'Saved on this device. It syncs to your other devices shortly.' };
  return { key: 'synced', label: 'Synced', detail: 'Saved and synced to your other devices.' };
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "Oct 3", "Oct 3, 2025". */
export function editedAgo(t: number, now: number, locale?: string): string {
  const s = Math.max(0, now - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const a = new Date(t), b = new Date(now);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(b) - day(a)) / 86_400_000);
  if (days === 0) return `${Math.floor(s / 3600)} h ago`;
  if (days === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (a.getFullYear() !== b.getFullYear()) opts.year = 'numeric';
  return a.toLocaleDateString(locale, opts);
}

/** "12.4 MB" */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
