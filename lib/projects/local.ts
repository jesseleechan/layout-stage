/* Projects in this browser, in the app's IndexedDB store (lib/persist.ts):
     projects                 { v: 1, currentId, items: LocalProject[], pendingDeletes: string[] }
     project:<id>             the canvas (Composition)
     project-thumb:<id>       a small JPEG of the canvas, for the projects list
   The open project's canvas is the autosave: the editor store saves every undo step here
   (saveOpenProject). The first run migrates the single autosave from before projects ("Untitled 1").
   Images stay in lib/images.ts, shared by id between projects. Browser only.

   One tab at a time: like the autosave before it, two tabs of the same browser each keep their own
   copy of the list, and the last one to save it wins. */
import { clone, type Composition } from '../model';
import { defaultComposition } from '../arrange';
import { deleteValue, getValue, loadComposition, sanitizeComposition, saveComposition, setValue } from '../persist';
import { newProjectId, referencedImageIds, untitledName, type LocalProject } from './model';

const K_INDEX = 'projects';
const K_DOC = 'project:';
const K_THUMB = 'project-thumb:';

export interface LocalIndex {
  v: 1;
  currentId: string;
  items: LocalProject[];
  /** Deleted here, still to be deleted from the store. */
  pendingDeletes: string[];
}

let state: LocalIndex | null = null;
const listeners = new Set<(e: LocalEvent) => void>();

export type LocalEvent = { type: 'saved'; id: string } | { type: 'changed' };

function emit(e: LocalEvent) {
  listeners.forEach((f) => f(e));
}
export function onLocalChange(fn: (e: LocalEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The list as this tab knows it, once the startup project has been opened. */
export function localIndex(): LocalIndex | null {
  return state;
}

function sanitizeIndex(raw: unknown): LocalIndex | null {
  const r = raw as Partial<LocalIndex> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.items)) return null;
  const items = r.items.filter((p): p is LocalProject => !!p && typeof p.id === 'string' && typeof p.name === 'string');
  return {
    v: 1,
    currentId: typeof r.currentId === 'string' ? r.currentId : '',
    items,
    pendingDeletes: Array.isArray(r.pendingDeletes) ? r.pendingDeletes.filter((x) => typeof x === 'string') : [],
  };
}

let writing: Promise<unknown> = Promise.resolve();
/** Changes the list and stores it; changes run one after another. */
export function updateLocal(change: (s: LocalIndex) => void): Promise<boolean> {
  const run = writing.then(async () => {
    if (!state) return false;
    change(state);
    const ok = await setValue(K_INDEX, clone(state));
    emit({ type: 'changed' });
    return ok;
  });
  writing = run.catch(() => undefined);
  return run;
}

let defaultJson = '';
/** Whether a canvas is still the one a new project starts with. */
export function isDefaultDoc(doc: Composition | null): boolean {
  if (!doc) return true;
  defaultJson ||= JSON.stringify(sanitizeComposition(defaultComposition()));
  return JSON.stringify(sanitizeComposition(doc)) === defaultJson;
}

export const findLocal = (id: string): LocalProject | undefined => state?.items.find((p) => p.id === id);

export const readDoc = async (id: string): Promise<Composition | null> => sanitizeComposition(await getValue(K_DOC + id));
export const writeDoc = (id: string, doc: Composition): Promise<boolean> => setValue(K_DOC + id, clone(doc));
export const readThumb = async (id: string): Promise<Blob | null> => {
  const v = await getValue<Blob>(K_THUMB + id);
  return v instanceof Blob ? v : null;
};
export const writeThumb = (id: string, blob: Blob): Promise<boolean> => setValue(K_THUMB + id, blob);

/** Removes a project's canvas and thumbnail from this browser (not its images: pruned at startup). */
export async function forgetProject(id: string): Promise<void> {
  await Promise.all([deleteValue(K_DOC + id), deleteValue(K_THUMB + id)]);
}

/** A new local project; stores its canvas first, so a listed project always has one. */
export async function addLocalProject(p: Omit<LocalProject, 'createdAt' | 'updatedAt' | 'rev' | 'dirty'> & Partial<LocalProject>, doc: Composition | null): Promise<LocalProject> {
  const now = Date.now();
  const item: LocalProject = { createdAt: now, updatedAt: now, rev: null, dirty: true, ...p };
  if (doc) await writeDoc(item.id, doc);
  await updateLocal((s) => {
    s.items = [item, ...s.items.filter((x) => x.id !== item.id)];
  });
  return item;
}

/** Startup (the editor store's init): migrates the single autosave from before projects on first run,
 *  and returns the open project's canvas. `ok` is false when storage couldn't be read, so nothing
 *  stored is overwritten. */
export async function openStartupProject(): Promise<{ ok: boolean; doc: Composition | null }> {
  const legacy = await loadComposition();
  if (!legacy.ok) return legacy;
  let idx = sanitizeIndex(await getValue(K_INDEX));
  if (!idx) {
    const id = newProjectId();
    const now = Date.now();
    if (legacy.doc) await writeDoc(id, legacy.doc);
    const blank = isDefaultDoc(legacy.doc);
    idx = { v: 1, currentId: id, items: [{ id, name: 'Untitled 1', createdAt: now, updatedAt: now, rev: null, dirty: true, blank }], pendingDeletes: [] };
    await setValue(K_INDEX, idx);
  }
  state = idx;
  let doc: Composition | null = null;
  const cur = idx.items.find((p) => p.id === idx!.currentId && !p.stub);
  if (cur) doc = await readDoc(cur.id);
  if (!cur || (!doc && !cur.dirty)) {
    // The open project is gone or was never downloaded: open the latest one there is, else a new one.
    const recent = [...idx.items].filter((p) => !p.stub).sort((a, b) => b.updatedAt - a.updatedAt);
    let found: LocalProject | null = null;
    for (const p of recent) {
      doc = await readDoc(p.id);
      if (doc) {
        found = p;
        break;
      }
    }
    if (!found) {
      doc = null;
      found = await addLocalProject({ id: newProjectId(), name: untitledName(idx.items.map((p) => p.name)), blank: true }, null);
    }
    await updateLocal((s) => {
      s.currentId = found!.id;
    });
  }
  return { ok: true, doc };
}

/** Autosave: every undo step of the open project. */
export async function saveOpenProject(doc: Composition): Promise<boolean> {
  if (!state) return saveComposition(doc); // storage couldn't be read at startup
  const id = state.currentId;
  const ok = await writeDoc(id, doc);
  await updateLocal((s) => {
    const p = s.items.find((x) => x.id === id);
    if (p) {
      p.updatedAt = Date.now();
      p.dirty = true;
      if (p.blank) p.blank = p.rev == null && isDefaultDoc(doc);
    }
  });
  emit({ type: 'saved', id });
  return ok;
}

/** Every image id the projects in this browser use, plus `also`; null when a canvas couldn't be read
 *  (then nothing may be pruned). */
export async function localImageIds(also: Iterable<string>): Promise<Set<string> | null> {
  const keep = new Set(also);
  if (!state) return null;
  for (const p of state.items) {
    if (p.stub) continue;
    const doc = await readDoc(p.id);
    if (!doc) {
      if (p.id === state.currentId) continue; // the open canvas is `also`
      return null;
    }
    referencedImageIds(doc).forEach((id) => keep.add(id));
  }
  return keep;
}
