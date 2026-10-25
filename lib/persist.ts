/* Autosave and saved styles, in IndexedDB. Browser only. */
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { clone, PRESETS, type Composition, type Style } from './model';
import { defaultComposition } from './arrange';
import { cleanSelectors } from './capture/selectors';
import { sanitizePlacements } from './canvas-size';
import { keepShownInMedia, sanitizeMedia } from './media';
import { sanitizeOverlays } from './overlays';
import { sanitizePinText } from './pin-text';

const LEGACY_STYLES_KEY = 'layoutStage.styles.v1'; // the prototype kept saved styles in localStorage
const K_DOC = 'composition';
const K_STYLES = 'styles';

let idb: UseStore | null = null;
function db(): UseStore | null {
  if (!idb && typeof indexedDB !== 'undefined') {
    try {
      idb = createStore('layout-stage', 'state');
    } catch {
      idb = null;
    }
  }
  return idb;
}

/** Generic key/value access to the app's IndexedDB store (e.g. recent capture URLs). */
export async function getValue<T>(key: string): Promise<T | undefined> {
  try {
    const s = db();
    return s ? ((await get(key, s)) as T | undefined) : undefined;
  } catch {
    return undefined;
  }
}
export async function setValue(key: string, value: unknown): Promise<boolean> {
  try {
    const s = db();
    if (!s) return false;
    await set(key, value, s);
    return true;
  } catch {
    return false;
  }
}
/** Projects (lib/projects/local.ts): removes a key. */
export async function deleteValue(key: string): Promise<boolean> {
  try {
    const s = db();
    if (!s) return false;
    await del(key, s);
    return true;
  } catch {
    return false;
  }
}

/** Fills in anything missing from an older or partial save; rejects anything unusable. */
export function sanitizeComposition(raw: unknown): Composition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Composition>;
  if (!(typeof r.W === 'number' && typeof r.H === 'number' && r.W > 0 && r.H > 0)) return null;
  if (!Array.isArray(r.slots) || r.slots.length !== 3) return null;
  if (!r.slots.every((s) => s && typeof s.imageId === 'string' && s.nw > 0 && s.nh > 0)) return null;
  const d = defaultComposition();
  const out: Composition = {
    ...d,
    ...clone(r),
    preset: r.preset && r.preset in PRESETS ? r.preset : 'custom',
    count: r.count === 1 || r.count === 2 || r.count === 3 ? r.count : d.count,
    // Saved before arrangements existed: arranged the classic way.
    arrangement: r.arrangement === 'showcase' ? 'showcase' : 'classic',
    order: Array.isArray(r.order) && r.order.length === 3 && [0, 1, 2].every((i) => r.order!.includes(i)) ? [...r.order] : [0, 1, 2],
    frame: { ...d.frame, ...clone(r.frame), shadow: { ...d.frame.shadow, ...clone(r.frame?.shadow) } },
    background: { ...d.background, ...clone(r.background) },
    overlays: sanitizeOverlays(r.overlays),
    pin: sanitizePinText(r.pin),
    placements: sanitizePlacements(r.placements),
    media: sanitizeMedia(r.media),
  } as Composition;
  if (!out.pin) delete out.pin;
  if (!out.placements) delete out.placements;
  // The gallery came later: the layouts' images join it (addMedia drops it when empty).
  keepShownInMedia(out);
  // Texture came later: none for anything saved before it, or anything unusable. (A window bar
  // option existed briefly and was dropped; its field is removed.)
  delete (out.frame as { bar?: unknown }).bar;
  const tex = Number(out.background.texture);
  out.background.texture = Number.isFinite(tex) ? Math.max(0, Math.min(100, tex)) : 0;
  // Capture options added later (dark mode, hide elements): defaults for captures saved before them.
  for (const s of [...out.slots, ...(out.media ?? [])]) {
    const o = s.source?.kind === 'url' ? s.source.options : null;
    if (o) Object.assign(o, { darkMode: o.darkMode === true, hideSelectors: cleanSelectors(o.hideSelectors) });
  }
  return out;
}

/** The autosaved canvas. `ok` is false when the read failed (as opposed to nothing being saved),
 *  so the caller doesn't mistake a storage error for a first run and overwrite the save. */
export async function loadComposition(): Promise<{ ok: boolean; doc: Composition | null }> {
  try {
    const s = db();
    if (!s) return { ok: false, doc: null };
    return { ok: true, doc: sanitizeComposition(await get(K_DOC, s)) };
  } catch {
    return { ok: false, doc: null };
  }
}

export function saveComposition(doc: Composition): Promise<boolean> {
  return setValue(K_DOC, clone(doc));
}

/** Saved styles; migrates the prototype's localStorage list on first run. */
export async function loadStyles(): Promise<Style[]> {
  const v = await getValue<Style[]>(K_STYLES);
  if (Array.isArray(v)) return v;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STYLES_KEY) || '[]');
    if (Array.isArray(legacy) && legacy.length) {
      const styles: Style[] = legacy.map((s: { name: string; frame: Style['frame']; bg?: Style['background']; background?: Style['background'] }) => ({
        name: s.name,
        frame: s.frame,
        background: s.background ?? s.bg ?? {},
      }));
      if (await setValue(K_STYLES, styles)) localStorage.removeItem(LEGACY_STYLES_KEY);
      return styles;
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function saveStyles(styles: Style[]): Promise<boolean> {
  return setValue(K_STYLES, clone(styles));
}
