/* The editor store: the single source of truth. Panels write to it; the preview and the export read
   from it. `doc` is the undoable Composition; everything else is UI state.

   Editing pattern (same as the prototype):
   - live changes (dragging, sliders while moving) call `edit()`, which never saves an undo step;
   - `commit()` saves a step if the doc changed (drag end, slider release, discrete actions);
   - discrete actions below commit themselves. Every commit/undo/redo autosaves. */
'use client';
import { create } from 'zustand';
import {
  applyStyleTo, clone, CUSTOM_MAX, CUSTOM_MIN, GRADS, MESHES, PRESETS, SHADOWS, defaultUi,
  type Background, type BackgroundType, type Composition, type CropId, type Frame, type PresetId,
  type Shadow, type ShadowPreset, type SlotSource, type Style, type UiState,
} from './model';
import { arrange, defaultComposition } from './arrange';
import { History } from './history';
import { capHeight, autoCrop, groupBounds, scrollAxis } from './render/units';
import { loadImage, pruneImages, putImage, releaseImage } from './images';
import { loadComposition, loadStyles, saveComposition, saveStyles } from './persist';

export interface Toast {
  id: number;
  msg: string;
}

/** A capture in flight. `target` is the slot it will replace, or null for the drop-elsewhere rule. */
export interface CaptureJob {
  id: number;
  url: string;
  target: number | null;
}

export interface NewImage {
  blob: Blob;
  name: string;
  source: SlotSource;
}

export interface EditorState {
  doc: Composition;
  ui: UiState;
  canUndo: boolean;
  canRedo: boolean;
  /** Preview zoom: screen px per canvas px. Written by the Stage. */
  scale: number;
  /** Snap guides in canvas px while dragging. */
  guides: { gx: number | null; gy: number | null };
  toast: Toast | null;
  savedStyles: Style[];
  /** True once the autosaved canvas (if any) has been restored. */
  hydrated: boolean;
  captureDialog: { open: boolean; target: number | null };
  captureJobs: CaptureJob[];

  /* --- core --- */
  init(): Promise<void>;
  edit(recipe: (d: Composition) => void): void;
  commit(): void;
  change(recipe: (d: Composition) => void): void;
  undo(): void;
  redo(): void;
  select(i: number | null): void;
  setUi(patch: Partial<UiState>): void;
  setScale(scale: number): void;
  setGuides(gx: number | null, gy: number | null): void;
  showToast(msg: string): void;
  /** Replaces the whole composition (tests, restore). Resets history. */
  loadComposition(doc: Composition): void;

  /* --- canvas & layouts --- */
  setPreset(p: PresetId): void;
  setCustomSize(W: number, H: number): void;
  setCount(n: 1 | 2 | 3): void;
  rearrange(): void;
  centerSelected(axis: 'h' | 'v'): void;
  centerGroup(): void;
  layer(dir: 1 | -1): void;
  removeSlot(i: number): void;
  /** Arrow-key nudge of the selected layout; saves a step after 350 ms idle. */
  nudge(dx: number, dy: number): void;
  setCrop(i: number, crop: CropId): void;
  /** Live: moves the Scroll (y) or Pan (x) position of a cropped image. Commit on release. */
  setScroll(i: number, v: number): void;
  /** Live: slot width. Commit on release. */
  setWidth(i: number, w: number): void;

  /* --- frame & background (live; commit on release) --- */
  editFrame(patch: Partial<Omit<Frame, 'shadow'>>): void;
  /** Changing blur/x/y/opacity marks the preset as custom. */
  editShadow(patch: Partial<Omit<Shadow, 'preset'>>): void;
  editBackground(patch: Partial<Background>): void;

  /* --- frame & background (discrete; commit) --- */
  setShadowPreset(p: Exclude<ShadowPreset, 'custom'>): void;
  setBackgroundType(t: BackgroundType): void;
  pickSolid(color: string): void;
  pickGradient(index: number): void;
  pickMesh(index: number): void;
  shuffleMesh(): void;
  setBackgroundFile(file: File): Promise<void>;
  backgroundFromLayout(): void;

  /* --- styles --- */
  applyStyle(st: Style): void;
  saveStyle(): Promise<void>;
  deleteStyle(index: number): Promise<void>;

  /* --- images in --- */
  /** Upload / drop / paste. target = slot to replace, or null (several files fill 1..n; one file
   *  fills the first sample slot, else adds a layout, else replaces layout 1). */
  placeFiles(files: File[], target: number | null): Promise<void>;
  /** One image from anywhere (e.g. a URL capture), placed by the single-file rule. */
  addImage(img: NewImage, target: number | null): Promise<boolean>;

  /* --- capture --- */
  openCapture(target: number | null): void;
  closeCapture(): void;
  startCaptureJob(url: string, target: number | null): number;
  endCaptureJob(id: number): void;
}

const NOT_IMAGE = 'That file isn’t an image. Use PNG, JPG or WebP.';
const isImageFile = (f: Blob) => f.type.startsWith('image/');

let history = new History(defaultComposition());
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;
let jobSeq = 0;
let initStarted = false;

function referencedIds(d: Composition): Set<string> {
  const ids = new Set(d.slots.map((s) => s.imageId));
  if (d.background.imageId) ids.add(d.background.imageId);
  return ids;
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Autosave shortly after each undo step (coalesces bursts). */
  const persistSoon = () => {
    if (!get().hydrated) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveComposition(get().doc), 200);
  };
  const syncHistory = () => set({ canUndo: history.canUndo, canRedo: history.canRedo });
  const edit = (recipe: (d: Composition) => void) => {
    const d = clone(get().doc);
    recipe(d);
    set({ doc: d });
  };
  const commit = () => {
    if (history.commit(get().doc)) {
      syncHistory();
      persistSoon();
    }
  };
  const change = (recipe: (d: Composition) => void) => {
    edit(recipe);
    commit();
  };
  const toast = (msg: string) => set({ toast: { id: ++toastSeq, msg } });
  const setUi = (patch: Partial<UiState>) => set({ ui: { ...get().ui, ...patch } });
  const afterRestore = (d: Composition) => {
    const sel = get().ui.selected;
    set({ doc: d, ui: { ...get().ui, selected: sel != null && sel >= d.count ? null : sel } });
    syncHistory();
    persistSoon();
  };
  /** Revokes object URLs of images that are no longer on the canvas. */
  const releaseUnused = (ids: (string | null)[]) => {
    const keep = referencedIds(get().doc);
    ids.forEach((id) => id && !keep.has(id) && releaseImage(id));
  };

  /** Loads a blob into slot i (live; caller commits). */
  const setSlotImage = async (i: number, img: NewImage): Promise<boolean> => {
    if (!isImageFile(img.blob)) {
      toast(NOT_IMAGE);
      return false;
    }
    const id = await putImage(img.blob);
    const el = await loadImage(id);
    if (!el) {
      toast(`Couldn’t read ${img.name || 'that image'}.`);
      return false;
    }
    const old = get().doc.slots[i].imageId;
    edit((d) => {
      const s = d.slots[i];
      Object.assign(s, {
        imageId: id, name: img.name || 'Pasted image', source: img.source, nw: el.naturalWidth, nh: el.naturalHeight,
        fx: 50, fy: 0, crop: autoCrop(el.naturalWidth, el.naturalHeight),
      });
      capHeight(s, d.H);
    });
    releaseUnused([old]);
    return true;
  };

  /** The single-image rule: target slot, else the first sample slot, else add a layout, else layout 1. */
  const placeOne = async (img: NewImage, target: number | null): Promise<boolean> => {
    const doc = get().doc;
    let i = target;
    let added = false;
    if (i == null) {
      i = doc.slots.slice(0, doc.count).findIndex((s) => s.source.kind === 'sample');
      if (i < 0) {
        if (doc.count < 3) { i = doc.count; added = true; } else i = 0;
      }
    }
    if (!(await setSlotImage(i, img))) return false;
    const idx = i;
    edit((d) => {
      if (added) {
        d.count = (idx + 1) as 1 | 2 | 3;
        arrange(d);
      }
    });
    setUi({ selected: idx });
    commit();
    return true;
  };

  return {
    doc: defaultComposition(),
    ui: defaultUi(),
    canUndo: false,
    canRedo: false,
    scale: 0.4,
    guides: { gx: null, gy: null },
    toast: null,
    savedStyles: [],
    hydrated: false,
    captureDialog: { open: false, target: null },
    captureJobs: [],

    async init() {
      if (initStarted) return;
      initStarted = true;
      const [saved, styles] = await Promise.all([loadComposition(), loadStyles()]);
      if (saved) {
        history = new History(saved);
        const sel = get().ui.selected;
        set({
          doc: saved,
          ui: { ...get().ui, selected: sel != null && sel < saved.count ? sel : null, exportScale: PRESETS[saved.preset].scale },
        });
      } else history.reset(get().doc);
      set({ savedStyles: styles, hydrated: true });
      syncHistory();
      void pruneImages(referencedIds(get().doc));
      if (!saved) void saveComposition(get().doc);
    },
    edit,
    commit,
    change,
    undo() {
      const d = history.undo();
      if (d) afterRestore(d);
    },
    redo() {
      const d = history.redo();
      if (d) afterRestore(d);
    },
    select(i) {
      setUi({ selected: i });
    },
    setUi,
    setScale(scale) {
      if (scale !== get().scale) set({ scale });
    },
    setGuides(gx, gy) {
      const g = get().guides;
      if (g.gx !== gx || g.gy !== gy) set({ guides: { gx, gy } });
    },
    showToast: toast,
    loadComposition(doc) {
      history = new History(doc);
      set({ doc: clone(doc), ui: { ...get().ui, selected: null } });
      syncHistory();
      persistSoon();
    },

    setPreset(p) {
      change((d) => {
        d.preset = p;
        if (p !== 'custom') { d.W = PRESETS[p].w; d.H = PRESETS[p].h; }
        arrange(d);
      });
      setUi({ exportScale: PRESETS[p].scale });
    },
    setCustomSize(W, H) {
      const clamp = (v: number) => Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.round(+v || 0)));
      change((d) => {
        d.W = clamp(W);
        d.H = clamp(H);
        arrange(d);
      });
    },
    setCount(n) {
      if (n === get().doc.count) return;
      change((d) => {
        d.count = n;
        arrange(d, n);
      });
      const sel = get().ui.selected;
      if (sel != null && sel >= n) setUi({ selected: n - 1 });
    },
    rearrange() {
      change((d) => arrange(d));
    },
    centerSelected(axis) {
      const i = get().ui.selected;
      if (i == null || i >= get().doc.count) return;
      change((d) => {
        if (axis === 'h') d.slots[i].cx = d.W / 2;
        else d.slots[i].cy = d.H / 2;
      });
    },
    centerGroup() {
      change((d) => {
        const b = groupBounds(d);
        const dx = d.W / 2 - (b.l + b.w / 2), dy = d.H / 2 - (b.t + b.h / 2);
        for (let i = 0; i < d.count; i++) { d.slots[i].cx += dx; d.slots[i].cy += dy; }
      });
    },
    layer(dir) {
      const i = get().ui.selected;
      const doc = get().doc;
      if (i == null || i >= doc.count) return;
      const o = doc.order.filter((j) => j < doc.count);
      const p = o.indexOf(i), q = p + dir;
      if (q < 0 || q >= o.length) {
        toast(dir > 0 ? 'Already in front.' : 'Already at the back.');
        return;
      }
      [o[p], o[q]] = [o[q], o[p]];
      change((d) => { d.order = [...o, ...[0, 1, 2].filter((j) => j >= d.count)]; });
    },
    removeSlot(i) {
      if (get().doc.count < 2) return;
      change((d) => {
        const [s] = d.slots.splice(i, 1);
        d.slots.push(s);
        d.order = d.order.map((j) => (j === i ? 2 : j > i ? j - 1 : j));
        d.count = (d.count - 1) as 1 | 2 | 3;
      });
      setUi({ selected: null });
    },
    nudge(dx, dy) {
      const i = get().ui.selected;
      if (i == null || i >= get().doc.count) return;
      edit((d) => { d.slots[i].cx += dx; d.slots[i].cy += dy; });
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(commit, 350);
    },
    setCrop(i, crop) {
      change((d) => {
        d.slots[i].crop = crop;
        capHeight(d.slots[i], d.H);
      });
    },
    setScroll(i, v) {
      edit((d) => {
        const s = d.slots[i];
        if (scrollAxis(s) === 'y') s.fy = v;
        else s.fx = v;
      });
    },
    setWidth(i, w) {
      edit((d) => { d.slots[i].w = w; });
    },

    editFrame(patch) {
      edit((d) => { Object.assign(d.frame, patch); });
    },
    editShadow(patch) {
      edit((d) => {
        Object.assign(d.frame.shadow, patch);
        if (Object.keys(patch).some((k) => k !== 'color')) d.frame.shadow.preset = 'custom';
      });
    },
    editBackground(patch) {
      edit((d) => { Object.assign(d.background, patch); });
    },

    setShadowPreset(p) {
      change((d) => { Object.assign(d.frame.shadow, SHADOWS[p], { preset: p }); });
    },
    setBackgroundType(t) {
      change((d) => { d.background.type = t; });
      if (t === 'image' && !get().doc.background.imageId) toast('Upload an image, or blur one of your layouts.');
    },
    pickSolid(color) {
      change((d) => { d.background.type = 'solid'; d.background.solid = color; });
    },
    pickGradient(index) {
      const [a, b, angle] = GRADS[index];
      change((d) => { d.background.type = 'gradient'; d.background.grad = { a, b, angle }; });
    },
    pickMesh(index) {
      change((d) => { d.background.type = 'mesh'; d.background.mesh = [...MESHES[index]]; });
    },
    shuffleMesh() {
      change((d) => { d.background.meshSeed = Math.floor(Math.random() * 100000); });
    },
    async setBackgroundFile(file) {
      if (!isImageFile(file)) { toast(NOT_IMAGE); return; }
      const id = await putImage(file);
      if (!(await loadImage(id))) { toast(`Couldn’t read ${file.name}.`); return; }
      const old = get().doc.background.imageId;
      change((d) => { Object.assign(d.background, { type: 'image', imageId: id, imageName: file.name, blur: 0, dim: 0 }); });
      releaseUnused([old]);
    },
    backgroundFromLayout() {
      const { doc, ui } = get();
      const i = ui.selected != null && ui.selected < doc.count ? ui.selected : 0;
      const old = doc.background.imageId;
      change((d) => {
        Object.assign(d.background, { type: 'image', imageId: d.slots[i].imageId, imageName: `Layout ${i + 1}, blurred`, blur: 40, dim: 0.06 });
      });
      releaseUnused([old]);
    },

    applyStyle(st) {
      change((d) => applyStyleTo(d, st));
    },
    async saveStyle() {
      const { doc, savedStyles } = get();
      const bg: Partial<Background> = clone(doc.background);
      let note = '';
      if (bg.type === 'image') {
        bg.type = 'solid';
        note = ' Background photos aren’t kept in styles, so it uses your solid color.';
      }
      delete bg.imageId;
      delete bg.imageName;
      let n = savedStyles.length + 1;
      while (savedStyles.some((s) => s.name === `My style ${n}`)) n++;
      const st: Style = { name: `My style ${n}`, frame: clone(doc.frame), background: bg };
      const next = [...savedStyles, st];
      set({ savedStyles: next });
      const ok = await saveStyles(next);
      toast(ok ? `Saved “${st.name}”.${note}` : `Added “${st.name}” for this session. This browser blocked storage, so it won’t be kept.`);
    },
    async deleteStyle(index) {
      const st = get().savedStyles[index];
      if (!st) return;
      const next = get().savedStyles.filter((_, i) => i !== index);
      set({ savedStyles: next });
      await saveStyles(next);
      toast(`Deleted “${st.name}”.`);
    },

    async placeFiles(files, target) {
      const imgs = files.filter(isImageFile).slice(0, 3);
      if (!imgs.length) { toast('Use PNG, JPG or WebP images.'); return; }
      if (imgs.length > 1 && target == null) {
        let ok = 0;
        for (let k = 0; k < imgs.length; k++) {
          if (await setSlotImage(k, { blob: imgs[k], name: imgs[k].name, source: { kind: 'file' } })) ok++;
        }
        if (!ok) return;
        edit((d) => {
          d.count = imgs.length as 1 | 2 | 3;
          arrange(d);
        });
        setUi({ selected: 0 });
        toast(`Placed ${imgs.length} layouts.`);
        commit();
      } else {
        await placeOne({ blob: imgs[0], name: imgs[0].name, source: { kind: 'file' } }, target);
      }
    },
    addImage(img, target) {
      return placeOne(img, target);
    },

    openCapture(target) {
      set({ captureDialog: { open: true, target } });
    },
    closeCapture() {
      set({ captureDialog: { ...get().captureDialog, open: false } });
    },
    startCaptureJob(url, target) {
      const id = ++jobSeq;
      set({ captureJobs: [...get().captureJobs, { id, url, target }] });
      return id;
    },
    endCaptureJob(id) {
      set({ captureJobs: get().captureJobs.filter((j) => j.id !== id) });
    },
  };
});

/* Test hook: lets Playwright load a fixed composition and read the store. */
declare global {
  interface Window {
    __layoutStage?: { store: typeof useEditor };
  }
}
if (typeof window !== 'undefined') window.__layoutStage = { store: useEditor };
