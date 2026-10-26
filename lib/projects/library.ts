/* The projects library: the list the projects control shows, the actions on it (new, open, duplicate,
   rename, delete) and background sync with the server's project store. Browser only.

   Switching projects shows that canvas with a fresh undo history, like a reload. A project from
   another device is listed at once (name, thumbnail); its canvas and images download when it's
   opened, images before the canvas shows them.

   Sync runs after local saves, debounced, and pulls when the editor starts, regains focus or every few
   minutes. Every push is two of the Blob store's monthly operations (Hobby includes 2,000), so pushes
   wait for a pause in editing and are at least PUSH_GAP apart; leaving a project or the tab pushes
   right away. Conflicts are decided per project (lib/projects/model.ts, planSync). */
import { create } from 'zustand';
import { defaultComposition } from '../arrange';
import { getImageBlob, hasImage, storeImage } from '../images';
import type { Composition } from '../model';
import { sanitizeComposition } from '../persist';
import { renderComposition } from '../render/export';
import { useEditor } from '../store';
import * as api from './api';
import * as L from './local';
import {
  cleanName, copyName, deviceCopyName, imageFileName, imageIdOf, megabytes, mergeImages, newProjectId, planSync, projectImageIds,
  revisionOf, syncStatus, thumbDue, untitledName, type LocalProject, type RemoteImage, type RemoteProject, type StatusView, type SyncMode, type SyncPhase,
} from './model';

/** A pause in editing before changes are pushed. */
export const PUSH_QUIET = 15_000;
/** Least time between pushes while editing: an hour of non-stop editing is at most 20 pushes, 40
 *  operations. */
export const PUSH_GAP = 3 * 60_000;
/** Longest a change waits while editing goes on. */
export const PUSH_MAX_WAIT = 5 * 60_000;
/** Least time between pushes when the tab is hidden again and again. */
const LEAVE_GAP = 30_000;
/** How often the list is checked for changes from other devices while the editor is visible. */
const POLL = 3 * 60_000;
/** Least time between checks on focus. */
const FOCUS_GAP = 45_000;
/** Thumbnail: longest side, px. */
const THUMB_PX = 320;
const THUMB_QUIET = 3_000;

export interface Transfer {
  id: string;
  name: string;
  loaded: number;
  total: number;
  /** Uploading (sync) or downloading (opening a project from another device). */
  dir: 'up' | 'down';
}

export interface ProjectsState {
  started: boolean;
  /** Most recently edited first. */
  items: LocalProject[];
  currentId: string | null;
  pendingDeletes: number;
  mode: SyncMode | null;
  phase: SyncPhase;
  sheetOpen: boolean;
  /** The project being opened. */
  opening: string | null;
  transfer: Transfer | null;

  start(): Promise<void>;
  openSheet(): void;
  closeSheet(): void;
  create(): Promise<void>;
  /** Opens a project (downloading it first when it's from another device) and closes the sheet,
   *  unless keepSheet. */
  open(id: string, opts?: { keepSheet?: boolean }): Promise<boolean>;
  cancelOpen(): void;
  duplicate(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Pushes everything now and pulls what changed elsewhere (tests; also the list's first look). */
  syncNow(): Promise<void>;
}

const toast = (msg: string) => useEditor.getState().showToast(msg);
const index = () => L.localIndex();
const isBusyError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

let remoteById = new Map<string, RemoteProject & { thumbUrl: string | null }>();
let lastPushAt = 0;
let lastSyncAt = 0;
let dirtySince = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let thumbTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = 30_000;
/** After a push fails, no push before this unless asked for; the wait doubles with each failure (every
 *  attempt costs store operations). */
let pushRetryAt = 0;
let pushBackoff = PUSH_GAP;
/** The open project changed since its thumbnail was made. */
let thumbStale = false;
let openAbort: AbortController | null = null;

/** Network work runs one job at a time. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const sorted = (items: LocalProject[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
const pendingWork = (s: ProjectsState) => s.pendingDeletes > 0 || s.items.some((p) => p.dirty && !p.blank && !p.stub);

/** What the projects control says about sync. */
export function statusOf(s: ProjectsState): StatusView {
  const v = syncStatus(s.mode, s.phase, pendingWork(s));
  if (s.transfer && s.transfer.total > 0) {
    const pct = Math.min(99, Math.floor((100 * s.transfer.loaded) / s.transfer.total));
    return { ...v, detail: `${s.transfer.dir === 'up' ? 'Uploading' : 'Downloading'} images: ${megabytes(s.transfer.loaded)} of ${megabytes(s.transfer.total)} (${pct}%).` };
  }
  return v;
}

export const useProjects = create<ProjectsState>()((set, get) => {
  const refresh = () => {
    const s = index();
    if (s) set({ items: sorted(s.items), currentId: s.currentId, pendingDeletes: s.pendingDeletes.length });
  };
  const setPhase = (phase: SyncPhase) => {
    if (get().phase !== phase) set({ phase });
  };
  const canSync = () => {
    const m = get().mode;
    return m === 'blob' || m === 'local';
  };

  /* ---------------- thumbnails ---------------- */

  /** Renders the open canvas small and keeps it as the project's thumbnail. */
  const makeThumb = async () => {
    clearTimeout(thumbTimer);
    const id = index()?.currentId;
    if (!id || !L.findLocal(id)) return;
    thumbStale = false;
    try {
      const doc = useEditor.getState().doc;
      const c = await renderComposition(doc, THUMB_PX / Math.max(doc.W, doc.H));
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
      c.width = c.height = 0;
      if (!blob || index()?.currentId !== id) return;
      await L.writeThumb(id, blob);
      const at = Date.now();
      await L.updateLocal((s) => {
        const p = s.items.find((x) => x.id === id);
        if (p) p.thumbAt = at;
      });
    } catch {
      thumbStale = true; // an image wasn't ready: next time
    }
  };
  const scheduleThumb = () => {
    thumbStale = true;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => void makeThumb(), THUMB_QUIET);
  };

  /* ---------------- pushing ---------------- */

  const scheduleFlush = () => {
    if (!canSync()) return;
    const now = Date.now();
    if (!dirtySince) dirtySince = now;
    const due = Math.max(lastPushAt + PUSH_GAP, pushRetryAt, Math.min(now + PUSH_QUIET, dirtySince + PUSH_MAX_WAIT));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void flush(false), Math.max(0, due - now));
  };

  /** Uploads one project: missing images, the thumbnail when due, then the canvas. */
  const pushOne = async (id: string, leaving: boolean, mode: SyncMode, again = true): Promise<void> => {
    const p = L.findLocal(id);
    if (!p || p.stub || (p.blank && p.rev == null)) return;
    const doc = await L.readDoc(id);
    if (!doc) return;
    const startedAt = p.updatedAt;

    let thumbRev = p.thumbRev ?? null;
    if (id === index()?.currentId && thumbStale) await makeThumb();
    const q = L.findLocal(id);
    // Not when the store has moved on (the push will be refused): the thumbnail would show this copy.
    const listed = remoteById.get(id);
    const behind = !!listed && listed.rev !== p.rev;
    if (q && !behind && thumbDue(q, Date.now(), leaving)) {
      const t = await L.readThumb(id);
      if (t) {
        await api.uploadFile(mode, id, 'thumb.jpg', t);
        thumbRev = String(q.thumbAt);
        await L.updateLocal((s) => {
          const x = s.items.find((y) => y.id === id);
          if (x) Object.assign(x, { thumbRev, thumbUploadedAt: Date.now() });
        });
      }
    }

    const known = new Set((L.findLocal(id)?.remoteImages ?? []).map((i) => imageIdOf(i.name)));
    const todo: { imageId: string; blob: Blob }[] = [];
    for (const imageId of projectImageIds(doc)) {
      if (known.has(imageId)) continue;
      const blob = await getImageBlob(imageId);
      if (blob) todo.push({ imageId, blob });
    }
    if (todo.length) {
      const total = todo.reduce((n, t) => n + t.blob.size, 0);
      let done = 0;
      set({ transfer: { id, name: p.name, loaded: 0, total, dir: 'up' } });
      try {
        for (const { imageId, blob } of todo) {
          const name = imageFileName(imageId, blob.type);
          await api.uploadFile(mode, id, `images/${name}`, blob, (loaded) => set({ transfer: { id, name: p.name, loaded: done + loaded, total, dir: 'up' } }));
          done += blob.size;
          await L.updateLocal((s) => {
            const x = s.items.find((y) => y.id === id);
            if (x) x.remoteImages = mergeImages(x.remoteImages, [{ name, size: blob.size }]);
          });
        }
      } finally {
        set({ transfer: null });
      }
    }

    const cur = L.findLocal(id);
    if (!cur) return; // deleted meanwhile
    const r = await api.pushProject(id, {
      baseRev: cur.rev, name: cur.name, createdAt: cur.createdAt, updatedAt: cur.updatedAt, thumbRev, images: cur.remoteImages ?? [], doc,
    });
    lastPushAt = Date.now();
    if (r.ok) {
      await L.updateLocal((s) => {
        const x = s.items.find((y) => y.id === id);
        if (!x) return;
        x.rev = r.project.rev;
        x.thumbRev = r.project.thumbRev;
        if (x.updatedAt === startedAt && x.name === cur.name) x.dirty = false;
      });
      remoteById.set(id, { ...r.project, thumbUrl: remoteById.get(id)?.thumbUrl ?? null });
    } else if (r.remote) {
      forkedFrom.delete(id);
      await fork(id, r.remote);
      const copy = forkedFrom.get(id);
      if (again && copy) await pushOne(copy, leaving, mode, false);
    } else if (again) {
      // Deleted on another device while it changed here: upload it again.
      await L.updateLocal((s) => {
        const x = s.items.find((y) => y.id === id);
        if (x) Object.assign(x, { rev: null, remoteImages: [], thumbRev: null });
      });
      await pushOne(id, leaving, mode, false);
    }
  };

  /** Pushes every changed project and carries out deletes. `leaving`: the tab or project is being left. */
  const flush = (leaving: boolean, force = false): Promise<void> => {
    clearTimeout(flushTimer);
    const mode = get().mode;
    if (mode !== 'blob' && mode !== 'local') return Promise.resolve();
    if (!force && (Date.now() < pushRetryAt || (leaving && Date.now() - lastPushAt < LEAVE_GAP))) {
      scheduleFlush();
      return Promise.resolve();
    }
    return exclusive(async () => {
      const s = index();
      if (!s) return;
      const work = s.items.filter((p) => p.dirty && !p.stub && !(p.blank && p.rev == null)).map((p) => p.id);
      if (!work.length && !s.pendingDeletes.length) return;
      setPhase('syncing');
      try {
        for (const id of [...s.pendingDeletes]) {
          await api.deleteRemote(id);
          await L.updateLocal((x) => {
            x.pendingDeletes = x.pendingDeletes.filter((d) => d !== id);
          });
        }
        for (const id of work) await pushOne(id, leaving, mode);
        dirtySince = 0;
        pushRetryAt = 0;
        pushBackoff = PUSH_GAP;
        synced();
      } catch (e) {
        if (!(e instanceof api.OfflineError) && !isBusyError(e)) {
          pushRetryAt = Date.now() + pushBackoff;
          pushBackoff = Math.min(pushBackoff * 2, 30 * 60_000);
        }
        failed(e);
      }
    });
  };

  /* ---------------- pulling ---------------- */

  const synced = () => {
    backoff = 30_000;
    clearTimeout(retryTimer);
    setPhase('idle');
    if (get().items.some((p) => p.dirty && !p.stub && !(p.blank && p.rev == null))) scheduleFlush();
  };
  const failed = (e: unknown) => {
    if (e instanceof api.OfflineError) setPhase('offline');
    else {
      if (!isBusyError(e)) console.warn('[projects] sync failed:', e instanceof Error ? e.message : e);
      setPhase('error');
    }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void syncAll(), backoff);
    backoff = Math.min(backoff * 2, 10 * 60_000);
  };

  const fetchThumb = async (id: string, remote: RemoteProject) => {
    const url = remoteById.get(id)?.thumbUrl;
    if (!url || !remote.thumbRev) return;
    const blob = await api.downloadThumb(url);
    if (!blob) return;
    await L.writeThumb(id, blob);
    await L.updateLocal((s) => {
      const x = s.items.find((y) => y.id === id);
      if (x) Object.assign(x, { thumbAt: Number(remote.thumbRev), thumbRev: remote.thumbRev });
    });
  };

  /** Downloads the images of a canvas that aren't on this device; resolves to how many couldn't be had. */
  const fetchImages = async (
    id: string, name: string, doc: Composition, files: Record<string, api.FileUrls> | null, images: RemoteImage[], signal?: AbortSignal,
  ): Promise<number> => {
    const missing: string[] = [];
    for (const imageId of projectImageIds(doc)) if (!(await hasImage(imageId))) missing.push(imageId);
    if (!missing.length) return 0;
    if (!files) {
      const f = await api.fetchProject(id);
      files = f?.files ?? {};
    }
    const byId = new Map(Object.keys(files).map((n) => [imageIdOf(n), n]));
    const sizes = new Map(images.map((i) => [i.name, i.size]));
    const jobs = missing.map((imageId) => ({ imageId, file: byId.get(imageId) ?? null }));
    const total = jobs.reduce((n, j) => n + (j.file ? sizes.get(j.file) ?? 0 : 0), 0);
    const loaded = new Map<string, number>();
    const report = () => set({ transfer: { id, name, total, loaded: [...loaded.values()].reduce((a, b) => a + b, 0), dir: 'down' } });
    report();
    let failedCount = 0;
    const queue = [...jobs];
    const worker = async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        const job = j;
        if (!job.file) {
          failedCount++;
          continue;
        }
        try {
          const blob = await api.downloadFile(files![job.file], (n) => {
            loaded.set(job.imageId, n);
            report();
          }, signal);
          await storeImage(job.imageId, blob);
        } catch (e) {
          if (isBusyError(e) || e instanceof api.OfflineError) throw e;
          failedCount++;
        }
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      set({ transfer: null });
    }
    return failedCount;
  };

  /** Takes the store's copy of a project this device hasn't changed. The open project gets its images
   *  first and is then shown, with a fresh undo history. */
  const pull = async (id: string, remote: RemoteProject) => {
    const f = await api.fetchProject(id);
    if (!f) return;
    const doc = sanitizeComposition(f.project.doc);
    if (!doc) return;
    // Only the name changed (or nothing): the open canvas and its undo history stay as they are.
    const sameCanvas = JSON.stringify(doc) === JSON.stringify(await L.readDoc(id));
    const isOpen = index()?.currentId === id && !sameCanvas;
    if (isOpen) {
      const lost = await fetchImages(id, f.project.name, doc, f.files, f.project.images);
      if (lost) toast(`${lost === 1 ? 'An image' : `${lost} images`} from another device couldn’t be downloaded.`);
      const now = L.findLocal(id);
      if (!now || now.dirty || index()?.currentId !== id) {
        if (now?.dirty) await fork(id, remote);
        return;
      }
      useEditor.getState().showProject(doc);
    }
    await L.writeDoc(id, doc);
    await L.updateLocal((s) => {
      const x = s.items.find((y) => y.id === id);
      if (!x) return;
      Object.assign(x, {
        name: f.project.name, createdAt: f.project.createdAt, updatedAt: f.project.updatedAt, rev: f.project.rev, dirty: false, stub: false, blank: false,
        remoteImages: f.project.images,
      });
    });
    if (remote.thumbRev && remote.thumbRev !== L.findLocal(id)?.thumbRev) await fetchThumb(id, remote);
    if (isOpen) toast('Updated from another device.');
  };

  /** Ids a fork moved: original id → the copy that keeps this device's changes. */
  const forkedFrom = new Map<string, string>();

  /** The same project changed here and on another device: this device's copy becomes a new project
   *  "<name> (this device)", and the original takes the store's copy. The open canvas stays as it is. */
  const fork = async (id: string, remote: RemoteProject) => {
    const p = L.findLocal(id);
    const doc = await L.readDoc(id);
    if (!p || !doc) return;
    const thumb = await L.readThumb(id);
    const copy: LocalProject = {
      ...p, id: newProjectId(), name: deviceCopyName(p.name, get().items.map((x) => x.name)), rev: null, dirty: true, blank: false, stub: false,
      remoteImages: [], thumbRev: null, thumbUploadedAt: undefined,
    };
    await L.writeDoc(copy.id, doc);
    if (thumb) await L.writeThumb(copy.id, thumb);
    await L.updateLocal((s) => {
      s.items = [copy, ...s.items];
      if (s.currentId === id) s.currentId = copy.id;
      const x = s.items.find((y) => y.id === id);
      if (x) x.dirty = false;
    });
    forkedFrom.set(id, copy.id);
    toast(`“${p.name}” also changed on another device. Your version is kept as “${copy.name}”.`);
    await pull(id, remote);
  };

  /** Changed here and elsewhere, but to the same name and canvas (the same edit on two devices): no
   *  copy to keep, this device's copy takes the store's revision. */
  const sameAsStore = async (id: string, remote: RemoteProject): Promise<boolean> => {
    const p = L.findLocal(id);
    const doc = await L.readDoc(id);
    if (!p || !doc || (await revisionOf(p.name, doc)) !== remote.rev) return false;
    await L.updateLocal((s) => {
      const x = s.items.find((y) => y.id === id);
      if (!x) return;
      x.rev = remote.rev;
      if (x.updatedAt === p.updatedAt && x.name === p.name) x.dirty = false; // unless it changed meanwhile
    });
    return true;
  };

  /** Removes a project deleted on another device. */
  const drop = async (id: string) => {
    const p = L.findLocal(id);
    if (!p) return;
    await L.updateLocal((s) => {
      s.items = s.items.filter((x) => x.id !== id);
    });
    await L.forgetProject(id);
    if (index()?.currentId === id) {
      toast(`“${p.name}” was deleted on another device.`);
      await openFallback();
    }
  };

  const adopt = async (r: RemoteProject) => {
    if (L.findLocal(r.id)) return;
    await L.updateLocal((s) => {
      s.items.push({ id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, rev: r.rev, dirty: false, stub: true, thumbRev: null });
    });
    if (r.thumbRev) await fetchThumb(r.id, r);
  };

  /** Checks the store's list and brings this device and the store together. */
  const syncAll = (): Promise<void> =>
    exclusive(async () => {
      if (!index()) return;
      lastSyncAt = Date.now();
      let listing: api.Listing;
      try {
        listing = await api.fetchListing();
      } catch (e) {
        failed(e);
        return;
      }
      set({ mode: listing.sync });
      if (listing.sync === 'off') {
        setPhase('idle');
        return;
      }
      remoteById = new Map(listing.projects.map((p) => [p.id, p]));
      const s = index()!;
      const plan = planSync(s.items, listing.projects, s.pendingDeletes);
      try {
        for (const a of plan) {
          if (a.kind !== 'push' && a.kind !== 'adopt' && a.kind !== 'thumb' && a.kind !== 'refresh') setPhase('syncing');
          switch (a.kind) {
            case 'delete':
              await api.deleteRemote(a.id);
              await L.updateLocal((x) => {
                x.pendingDeletes = x.pendingDeletes.filter((d) => d !== a.id);
              });
              break;
            case 'pull':
              await pull(a.id, a.remote);
              break;
            case 'fork':
              if (!(await sameAsStore(a.id, a.remote))) await fork(a.id, a.remote);
              break;
            case 'drop':
              await drop(a.id);
              break;
            case 'recreate':
              await L.updateLocal((x) => {
                const p = x.items.find((y) => y.id === a.id);
                if (p) Object.assign(p, { rev: null, remoteImages: [], thumbRev: null });
              });
              break;
            case 'adopt':
              await adopt(a.remote);
              break;
            case 'refresh':
              await L.updateLocal((x) => {
                const p = x.items.find((y) => y.id === a.id);
                if (p) Object.assign(p, { name: a.remote.name, updatedAt: a.remote.updatedAt, rev: a.remote.rev, createdAt: a.remote.createdAt });
              });
              if (a.remote.thumbRev !== L.findLocal(a.id)?.thumbRev) await fetchThumb(a.id, a.remote);
              break;
            case 'thumb':
              await fetchThumb(a.id, a.remote);
              break;
            case 'push':
              break; // pushes go through flush(), which spaces them out
          }
        }
        // Deleted here and already gone from the store.
        const live = new Set(listing.projects.map((p) => p.id));
        if (index()!.pendingDeletes.some((d) => !live.has(d))) {
          await L.updateLocal((x) => {
            x.pendingDeletes = x.pendingDeletes.filter((d) => live.has(d));
          });
        }
        synced();
      } catch (e) {
        failed(e);
      }
    });

  /* ---------------- switching ---------------- */

  /** Before another project opens: the one being left gets a fresh thumbnail and its changes go out. */
  const leaveCurrent = async () => {
    if (thumbStale) await makeThumb();
    void flush(true);
  };

  /** Shows a project that's on this device. */
  const show = async (id: string, doc: Composition) => {
    await L.updateLocal((s) => {
      s.currentId = id;
    });
    useEditor.getState().showProject(doc);
    thumbStale = !L.findLocal(id)?.thumbAt;
    if (thumbStale) scheduleThumb();
  };

  /** After the open project is deleted: the latest other one on this device, else a new one. */
  const openFallback = async () => {
    for (const p of get().items) {
      if (p.stub || p.id === index()?.currentId) continue;
      const doc = await L.readDoc(p.id);
      if (doc && (await get().open(p.id, { keepSheet: true }))) return;
    }
    await newProject();
  };

  const newProject = async () => {
    const doc = defaultComposition();
    const item = await L.addLocalProject({ id: newProjectId(), name: untitledName(get().items.map((p) => p.name)), blank: true }, doc);
    await show(item.id, doc);
  };

  const onSaved = () => {
    scheduleThumb();
    scheduleFlush();
  };

  return {
    started: false,
    items: [],
    currentId: null,
    pendingDeletes: 0,
    mode: null,
    phase: 'unknown',
    sheetOpen: false,
    opening: null,
    transfer: null,

    async start() {
      if (get().started) return;
      set({ started: true });
      await new Promise<void>((res) => {
        if (useEditor.getState().hydrated) return res();
        const off = useEditor.subscribe((s) => {
          if (s.hydrated) {
            off();
            res();
          }
        });
      });
      if (!index()) return; // storage blocked: the canvas still works, there's just no list
      refresh();
      L.onLocalChange((e) => {
        refresh();
        if (e.type === 'saved') onSaved();
      });
      const cur = L.findLocal(index()!.currentId);
      if (cur && !cur.thumbAt) scheduleThumb();
      if (typeof window !== 'undefined') {
        const check = () => {
          if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > FOCUS_GAP) void syncAll();
        };
        window.addEventListener('focus', check);
        window.addEventListener('online', () => void syncAll());
        window.addEventListener('offline', () => setPhase('offline'));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            if (thumbStale) void makeThumb();
            void flush(true);
          } else check();
        });
        setInterval(() => {
          if (document.visibilityState === 'visible') void syncAll();
        }, POLL);
      }
      await syncAll();
    },

    openSheet() {
      set({ sheetOpen: true });
      if (thumbStale) void makeThumb();
      if (Date.now() - lastSyncAt > FOCUS_GAP) void syncAll();
    },
    closeSheet() {
      if (get().opening) openAbort?.abort();
      set({ sheetOpen: false });
    },

    async create() {
      if (get().opening || !index()) return;
      await leaveCurrent();
      await newProject();
      set({ sheetOpen: false });
    },

    async open(id, opts) {
      if (get().opening || !index()) return false;
      const p = L.findLocal(id);
      if (!p) return false;
      if (id === index()!.currentId) {
        if (!opts?.keepSheet) set({ sheetOpen: false });
        return true;
      }
      if (useEditor.getState().captureJobs.length) {
        toast('Wait for the capture to finish, then switch projects.');
        return false;
      }
      const ac = new AbortController();
      openAbort = ac;
      set({ opening: id });
      try {
        await leaveCurrent();
        let doc = p.stub ? null : await L.readDoc(id);
        let files: Record<string, api.FileUrls> | null = null;
        const remote = remoteById.get(id);
        const stale = !!remote && remote.rev !== p.rev && !p.dirty;
        if ((!doc || stale) && canSync()) {
          try {
            const f = await api.fetchProject(id);
            const got = f && sanitizeComposition(f.project.doc);
            if (f && got) {
              doc = got;
              files = f.files;
              await L.writeDoc(id, doc);
              await L.updateLocal((s) => {
                const x = s.items.find((y) => y.id === id);
                if (x) {
                  Object.assign(x, {
                    name: f.project.name, createdAt: f.project.createdAt, updatedAt: f.project.updatedAt, rev: f.project.rev, dirty: false, stub: false,
                    blank: false, remoteImages: f.project.images,
                  });
                }
              });
            } else if (!f && !doc) {
              toast(`“${p.name}” was deleted on another device.`);
              await drop(id);
              return false;
            }
          } catch (e) {
            if (!(e instanceof api.OfflineError) || !doc) throw e;
          }
        }
        if (!doc) {
          toast(get().mode === 'off' ? `Sync is off, so “${p.name}” can’t be downloaded here.` : `“${p.name}” couldn’t be downloaded. Try again in a moment.`);
          return false;
        }
        const here = L.findLocal(id);
        const lost = canSync()
          ? await fetchImages(id, here?.name ?? p.name, doc, files, here?.remoteImages ?? [], ac.signal)
          : (await Promise.all(projectImageIds(doc).map(hasImage))).filter((x) => !x).length;
        if (ac.signal.aborted) return false;
        if (lost) toast(`${lost === 1 ? 'An image' : `${lost} images`} couldn’t be downloaded.`);
        if (ac.signal.aborted) return false;
        await show(id, doc);
        if (!opts?.keepSheet) set({ sheetOpen: false });
        return true;
      } catch (e) {
        if (!isBusyError(e)) {
          toast(e instanceof api.OfflineError ? `You’re offline, and “${p.name}” isn’t on this device yet.` : `Couldn’t open “${p.name}”. Try again in a moment.`);
        }
        return false;
      } finally {
        if (openAbort === ac) openAbort = null;
        set({ opening: null, transfer: null });
      }
    },

    cancelOpen() {
      openAbort?.abort();
    },

    async duplicate(id) {
      if (get().opening || !index()) return;
      const p = L.findLocal(id);
      const doc = id === index()!.currentId ? useEditor.getState().doc : await L.readDoc(id);
      if (!p || !doc || p.stub) return;
      // Images it has only in the store come first, so the copy can be opened and uploaded.
      if (canSync()) await fetchImages(id, p.name, doc, null, p.remoteImages ?? []).catch(() => 0);
      const thumb = await L.readThumb(id);
      const item = await L.addLocalProject(
        { id: newProjectId(), name: copyName(p.name, get().items.map((x) => x.name)), blank: false, thumbAt: p.thumbAt },
        doc,
      );
      if (thumb) await L.writeThumb(item.id, thumb);
      await get().open(item.id);
      scheduleFlush();
    },

    async rename(id, raw) {
      const name = cleanName(raw);
      const p = L.findLocal(id);
      if (!p || !name || name === p.name) return;
      if (p.stub) {
        // Not on this device yet: its canvas comes first, so the renamed copy can be uploaded.
        const f = canSync() ? await api.fetchProject(id).catch(() => null) : null;
        const doc = f && sanitizeComposition(f.project.doc);
        if (!f || !doc) {
          toast(`Open “${p.name}” first, then rename it.`);
          return;
        }
        await L.writeDoc(id, doc);
        await L.updateLocal((s) => {
          const x = s.items.find((y) => y.id === id);
          if (x) Object.assign(x, { stub: false, rev: f.project.rev, remoteImages: f.project.images, updatedAt: f.project.updatedAt });
        });
      }
      await L.updateLocal((s) => {
        const x = s.items.find((y) => y.id === id);
        if (x) Object.assign(x, { name, updatedAt: Date.now(), dirty: true, blank: false });
      });
      scheduleFlush();
    },

    async remove(id) {
      const p = L.findLocal(id);
      if (!p || !index()) return;
      await L.updateLocal((s) => {
        s.items = s.items.filter((x) => x.id !== id);
        // Also one never synced but no longer blank: its first upload may be on its way.
        const maybeStored = p.rev != null || (!p.blank && canSync());
        if (maybeStored && !s.pendingDeletes.includes(id)) s.pendingDeletes.push(id);
      });
      await L.forgetProject(id);
      if (index()!.currentId === id) await openFallback();
      scheduleFlush();
    },

    async syncNow() {
      await flush(false, true);
      await syncAll();
      await flush(false, true);
    },
  };
});

/* Test hook: lets Playwright drive sync and read the list. */
declare global {
  interface Window {
    __layoutProjects?: typeof useProjects;
  }
}
if (typeof window !== 'undefined') window.__layoutProjects = useProjects;
