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
  type Arrangement, type Background, type BackgroundType, type Composition, type CropId, type Frame, type MediaItem,
  type PresetId, type Shadow, type ShadowPreset, type Slot, type SlotSource, type Style, type UiState,
} from './model';
import { applyArrangement, arrange, arrangementOf, defaultComposition, pageMeasure, runsOff, showFirstPage, showsWholePages, startCrop } from './arrange';
import { isArranged, resizeCanvas } from './canvas-size';
import { History } from './history';
import { capHeight, cropRatio, groupBounds, scrollAxis } from './render/units';
import { ingestImage, loadImage, pruneImages, releaseImage } from './images';
import { loadStyles, saveStyles } from './persist';
import { localImageIds, openStartupProject, saveOpenProject } from './projects/local';
import { exportComposition, renderComposition } from './render/export';
import { alignLayouts, canAlign, distributeLayouts, type AlignEdge } from './align';
import { nextSiteBackground, paletteOf } from './palette';
import { dropSlot, reframe } from './capture/recapture';
import { anyOverlay, patchOverlay, type OverlayKey, type Overlays } from './overlays';
import { setCropOf, setHeight as setSlotHeight } from './crop';
import { addCallout } from './callout';
import { addMedia, keepShownInMedia, MAX_MEDIA, mediaOf, putImage, removeMedia, replaceMedia, slotFor } from './media';
import { PIN_LIMITS, type PinField } from './pin-text';
import { captureOn } from './capture/switch';

export interface Toast {
  id: number;
  msg: string;
}

/** A capture in flight. `target` is the layout it was asked to replace (null: the drop-elsewhere
 *  rule); `targetId` is that layout's image, which follows the layout if others are removed. */
export interface CaptureJob {
  id: number;
  url: string;
  target: number | null;
  targetId: string | null;
  /** A page of a whole-site capture: it lands in Media (landMedia), not on a layout. */
  media?: boolean;
}

/** The visible layout a capture job will replace now, or null when it will use the drop-elsewhere
 *  rule (no target, or its layout was removed or replaced meanwhile). */
export function captureJobSlot(doc: Composition, job: CaptureJob): number | null {
  if (job.targetId == null) return null;
  const i = doc.slots.findIndex((s, k) => k < doc.count && s.imageId === job.targetId);
  return i < 0 ? null : i;
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
  captureDialog: { open: boolean; target: number | null; recapture?: boolean };
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
  /** Another canvas size keeps the work: see lib/canvas-size.ts. */
  setPreset(p: PresetId): void;
  setCustomSize(W: number, H: number): void;
  setCount(n: 1 | 2 | 3): void;
  /** Starts the layouts over in another arrangement, with its crops (showcase shows pages whole). */
  setArrangement(a: Arrangement): void;
  rearrange(): void;
  /** Layout i shows layout 1's page; in the showcase columns it continues where layout 1 leaves off. */
  continuePage(i: number): void;
  centerSelected(axis: 'h' | 'v'): void;
  centerGroup(): void;
  layer(dir: 1 | -1): void;
  removeSlot(i: number): void;
  /** Arrow-key nudge of the selected layout; saves a step after 350 ms idle. */
  nudge(dx: number, dy: number): void;
  setCrop(i: number, crop: CropId): void;
  /** Live: the layout's height at its width (a free-height crop, lib/crop.ts), keeping its top edge.
   *  `snapRatio` (default on) turns a height near Full or a preset into that crop. Commit on release. */
  setHeight(i: number, h: number, snapRatio?: boolean): void;
  /** Live: how far layout i zooms into its image (1–4; lib/callout.ts). Commit on release. */
  setZoom(i: number, zoom: number): void;
  /** Live: the window's position on both axes (a zoomed layout pans both ways). Commit on release. */
  setWindow(i: number, at: Partial<Pick<Slot, 'fx' | 'fy'>>): void;
  /** Adds a zoom callout of layout i: a new layout on top showing its page magnified (one step). */
  addCallout(i: number): void;
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
  /** Upload / drop / paste. target = slot to replace, or null (several files fill 1..3; one file
   *  fills the first sample slot, else adds a layout, else replaces layout 1). Every image also goes
   *  into the media gallery (up to MAX_MEDIA files: the ones past three wait there). */
  placeFiles(files: File[], target: number | null): Promise<void>;
  /** One image from anywhere (e.g. a URL capture), placed by the single-file rule. */
  addImage(img: NewImage, target: number | null): Promise<boolean>;

  /* --- media gallery (lib/media.ts) --- */
  /** Adds images to the gallery only, as one undo step. */
  addMediaFiles(files: File[]): Promise<void>;
  /** Puts a gallery image in layout `target` (null: the single-file rule) and selects it. */
  placeMedia(id: string, target: number | null): void;
  /** Takes an image out of the gallery (not one a visible layout shows). */
  removeMediaItem(id: string): void;

  /* --- capture --- */
  openCapture(target: number | null): void;
  closeCapture(): void;
  startCaptureJob(url: string, target: number | null, media?: boolean): number;
  endCaptureJob(id: number): void;

  /* --- canvas tools: align and distribute (lib/align.ts) --- */
  /** Moves the other visible layouts so their edge or center lines up with the selected one. */
  align(edge: AlignEdge): void;
  /** Equal gaps between the visible layouts along an axis (needs 3). */
  distribute(axis: 'h' | 'v'): void;

  /* --- match site colors (output features) --- */
  /** Background from the colors of the selected layout (else layout 1): a mesh, then a gradient,
   *  then a solid on each further click. One undo step per click. */
  matchSiteColors(): Promise<void>;

  /* --- re-capture and desktop + phone captures (lib/capture/jobs.ts, lib/capture/recapture.ts) --- */
  /** Opens the capture dialog to re-capture layout i from its URL and options, keeping its framing
   *  (for pages behind a password, which is never stored, so the dialog asks for it again). */
  openRecapture(i: number): void;
  /** Lands a captured image as its own undo step (async: through step()). With keepFraming it
   *  replaces the image of the layout showing `targetId` and keeps that layout's framing (crop,
   *  scroll, position, width; see reframe()); otherwise it fills that layout as an upload would.
   *  When that layout is gone (or there is none) it uses the drop-elsewhere rule, never on the layout
   *  showing `avoidId`. Resolves to the new image id, or null when the image couldn't be read. */
  landCapture(img: NewImage, at: { targetId: string | null; keepFraming?: boolean; avoidId?: string | null }): Promise<string | null>;
  /** Puts a whole composition on the canvas (a pin variation, lib/variations.ts), as one undo step. */
  putComposition(d: Composition): void;
  /** Lands a page of a whole-site capture as its own undo step: in the first visible layout still
   *  showing a sample, else in Media only. Resolves to the new image id, or null when it couldn't be read. */
  landMedia(img: NewImage): Promise<string | null>;

  /* --- overlays: headline, badge, watermark (lib/overlays.ts) --- */
  /** Live: changes an overlay (typing, sliders) without saving a step. Commit on release / pause. */
  editOverlay<K extends OverlayKey>(key: K, patch: Partial<Overlays[K]>): void;
  /** Turns every overlay off in one step (canvases from when the editor had a Text & logo panel). */
  hideOverlays(): void;
  /** Discrete: changes an overlay and saves one step (toggles, presets, fonts). */
  setOverlay<K extends OverlayKey>(key: K, patch: Partial<Overlays[K]>): void;
  /** Stores a logo and makes it the watermark: one step once it has loaded. */
  setWatermarkLogo(file: File): Promise<void>;

  /* --- pin text (lib/pin-text.ts) --- */
  /** Live: typing in a pin text field keeps the text with the canvas. Commit on pause / blur. */
  editPinText(field: PinField, value: string): void;
  /** Discrete: the field follows its suggestion again. One undo step. */
  resetPinText(field: PinField): void;

  /* --- projects (lib/projects) --- */
  /** Shows another project's canvas with a fresh undo history, like a reload. Doesn't autosave: the
   *  doc is that project's saved canvas. */
  showProject(doc: Composition): void;
}

const NOT_IMAGE = 'That file isn’t an image. Use PNG, JPG or WebP.';
const isImageFile = (f: Blob) => f.type.startsWith('image/');

let history = new History(defaultComposition());
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
let autosave = false; // on once the saved canvas has been read
let toastSeq = 0;
let jobSeq = 0;
let initStarted = false;

/** Images this doc shows: the visible layouts, and the background photo while it's the background. */
export function shownIds(d: Composition): Set<string> {
  const ids = new Set(d.slots.slice(0, d.count).map((s) => s.imageId));
  if (d.background.type === 'image' && d.background.imageId) ids.add(d.background.imageId);
  const wm = d.overlays?.watermark;
  if (wm?.enabled && wm.kind === 'logo' && wm.imageId) ids.add(wm.imageId);
  return ids;
}

/** A layout's top edge, and moving its center so the top edge stays there after its height changed. */
const topOf = (s: Slot) => s.cy - s.w / cropRatio(s) / 2;
const keepTop = (s: Slot, top: number) => { s.cy = top + s.w / cropRatio(s) / 2; };

function referencedIds(d: Composition): Set<string> {
  const ids = new Set(d.slots.map((s) => s.imageId));
  if (d.background.imageId) ids.add(d.background.imageId);
  if (d.overlays?.watermark.imageId) ids.add(d.overlays.watermark.imageId);
  for (const m of mediaOf(d)) ids.add(m.imageId);
  return ids;
}

/** What a toast says when adding images pushed older ones out of the gallery. */
const mediaFull = (n: number) =>
  `Media keeps ${MAX_MEDIA}: ${n === 1 ? 'the oldest unused image was' : `the ${n} oldest unused images were`} removed.`;

export const useEditor = create<EditorState>()((set, get) => {
  /** Autosave: stores the last undo step (never a half-finished drag) as soon as it's saved, as the
   *  open project's canvas (lib/projects/local.ts). */
  const persist = () => {
    if (autosave) void saveOpenProject(history.current);
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
      persist();
    }
  };
  const change = (recipe: (d: Composition) => void) => {
    edit(recipe);
    commit();
  };
  /** A change that arrives asynchronously (an image finished loading): its own undo step on top of
   *  the last saved state, so an edit in progress (drag, slider, pending nudge) stays out of it. */
  const step = (recipe: (d: Composition) => void) => {
    edit(recipe);
    if (history.commitPatch(recipe)) {
      syncHistory();
      persist();
    }
  };
  const toast = (msg: string) => set({ toast: { id: ++toastSeq, msg } });
  const setUi = (patch: Partial<UiState>) => set({ ui: { ...get().ui, ...patch } });
  const afterRestore = (d: Composition) => {
    const sel = get().ui.selected;
    set({ doc: d, ui: { ...get().ui, selected: sel != null && sel >= d.count ? null : sel } });
    syncHistory();
    persist();
  };
  /** Revokes object URLs of images that are no longer on the canvas. */
  const releaseUnused = (ids: (string | null)[]) => {
    const keep = referencedIds(get().doc);
    ids.forEach((id) => id && !keep.has(id) && releaseImage(id));
  };

  /** Stores (downscaled when over the storage budget) and decodes an image. Returns it as a gallery
   *  image for putImage(), or null (with a toast). */
  const ingest = async (img: NewImage): Promise<MediaItem | null> => {
    if (!isImageFile(img.blob)) {
      toast(NOT_IMAGE);
      return null;
    }
    const got = await ingestImage(img.blob);
    if (!got) {
      toast(`Couldn’t read ${img.name || 'that image'}.`);
      return null;
    }
    return { imageId: got.id, name: img.name || 'Pasted image', source: img.source, nw: got.nw, nh: got.nh };
  };
  /** Layouts still where arrange() put them are placed again after an image changes (classic ones
   *  stay put, as they always have). */
  const freshlyArranged = (d: Composition) => arrangementOf(d) !== 'classic' && isArranged(d, pageMeasure());

  /** The single-image rule (slotFor): target slot, else the first sample slot, else add a layout,
   *  else layout 1, picked from the layouts as they are now. One step (async: through step());
   *  the image and `also` go into the gallery. Returns how many gallery images made room. */
  const placeOne = (item: MediaItem, target: number | null, also: MediaItem[] = []): number => {
    const doc = get().doc;
    const { i, added } = slotFor(doc, target);
    const old = doc.slots[i].imageId;
    const fresh = freshlyArranged(doc);
    let dropped = 0;
    step((d) => {
      putImage(d, i, item);
      if (added) d.count = (i + 1) as 1 | 2 | 3;
      if (added || fresh) arrange(d, d.count, pageMeasure());
      dropped = addMedia(d, [item, ...also]);
    });
    setUi({ selected: i });
    releaseUnused([old]);
    return dropped;
  };
  /** Ingests files one by one (the gallery's limit at most), skipping ones that can't be read. */
  const ingestFiles = async (files: File[]): Promise<MediaItem[]> => {
    const items: MediaItem[] = [];
    for (const f of files.filter(isImageFile).slice(0, MAX_MEDIA)) {
      const it = await ingest({ blob: f, name: f.name, source: { kind: 'file' } });
      if (it) items.push(it);
    }
    return items;
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
      const [loaded, styles] = await Promise.all([openStartupProject(), loadStyles()]);
      const saved = loaded.doc;
      if (saved) {
        history = new History(saved);
        const sel = get().ui.selected;
        set({
          doc: saved,
          ui: {
            ...get().ui,
            selected: sel != null && sel < saved.count ? sel : null,
            exportScale: PRESETS[saved.preset].scale,
            showSafeArea: PRESETS[saved.preset].safe === 'etsy',
          },
        });
      } else history.reset(get().doc);
      set({ savedStyles: styles, hydrated: true });
      syncHistory();
      autosave = true;
      // A failed read isn't a first run: keep the stored canvas and images untouched.
      if (loaded.ok) {
        if (!saved) persist();
        // Every project in this browser keeps its images (null: a canvas couldn't be read, prune nothing).
        void localImageIds(referencedIds(get().doc)).then((keep) => keep && pruneImages(keep));
      }
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
      persist();
    },

    setPreset(p) {
      change((d) => {
        if (p === 'custom') d.preset = p;
        else resizeCanvas(d, PRESETS[p].w, PRESETS[p].h, pageMeasure(), p);
      });
      // Etsy crops listing thumbnails to 5:4, so its canvases open with that crop shown.
      setUi({ exportScale: PRESETS[p].scale, showSafeArea: PRESETS[p].safe === 'etsy' });
    },
    setCustomSize(W, H) {
      const clamp = (v: number) => Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.round(+v || 0)));
      change((d) => { resizeCanvas(d, clamp(W), clamp(H), pageMeasure()); });
    },
    setCount(n) {
      if (n === get().doc.count) return;
      change((d) => {
        // Layouts coming into view take the arrangement's crop (classic ones keep theirs).
        const a = arrangementOf(d);
        if (a !== 'classic') d.slots.forEach((s, i) => { if (i >= d.count && i < n) setCropOf(s, startCrop(a, i, s)); });
        d.count = n;
        arrange(d, n, pageMeasure());
        keepShownInMedia(d);
      });
      const sel = get().ui.selected;
      if (sel != null && sel >= n) setUi({ selected: n - 1 });
    },
    setArrangement(a) {
      if (a === arrangementOf(get().doc)) return;
      change((d) => applyArrangement(d, a, pageMeasure()));
    },
    rearrange() {
      change((d) => arrange(d, d.count, pageMeasure()));
    },
    continuePage(i) {
      const doc = get().doc;
      if (i < 1 || i >= doc.count) return;
      const old = doc.slots[i].imageId;
      const fresh = freshlyArranged(doc);
      change((d) => {
        const s = d.slots[i];
        const top = topOf(s);
        showFirstPage(d, i);
        if (fresh || !showsWholePages(arrangementOf(d))) arrange(d, d.count, pageMeasure());
        else keepTop(s, top);
      });
      releaseUnused([old]);
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
        const s = d.slots[i];
        const top = topOf(s);
        setCropOf(s, crop);
        // Pages shown whole may run off the canvas: the layout keeps its width and top edge.
        if (runsOff(arrangementOf(d), i)) keepTop(s, top);
        else capHeight(s, d.H);
      });
    },
    setScroll(i, v) {
      edit((d) => {
        const s = d.slots[i];
        if (scrollAxis(s) === 'y') s.fy = v;
        else s.fx = v;
      });
    },
    setHeight(i, h, snapRatio = true) {
      edit((d) => { setSlotHeight(d.slots[i], h, snapRatio); });
    },
    setWidth(i, w) {
      edit((d) => { d.slots[i].w = w; });
    },
    setZoom(i, zoom) {
      edit((d) => {
        if (zoom > 1) d.slots[i].zoom = Math.min(4, zoom);
        else delete d.slots[i].zoom;
      });
    },
    setWindow(i, at) {
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      edit((d) => {
        if (at.fx != null) d.slots[i].fx = clamp(at.fx);
        if (at.fy != null) d.slots[i].fy = clamp(at.fy);
      });
    },
    addCallout(i) {
      const doc = get().doc;
      if (i < 0 || i >= doc.count) return;
      if (doc.count >= 3) { toast('A callout is a layout of its own, and there are 3 already. Remove one first.'); return; }
      const j = doc.count;
      change((d) => { addCallout(d, i, j); });
      setUi({ selected: j });
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
      const got = await ingestImage(file);
      if (!got) { toast(`Couldn’t read ${file.name}.`); return; }
      const id = got.id;
      const old = get().doc.background.imageId;
      step((d) => { Object.assign(d.background, { type: 'image', imageId: id, imageName: file.name, blur: 0, dim: 0 }); });
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
      if (!files.some(isImageFile)) { toast('Use PNG, JPG or WebP images.'); return; }
      const items = await ingestFiles(files);
      if (!items.length) return;
      const waiting = (n: number) => (n === 1 ? ' 1 more is in Media.' : n > 1 ? ` ${n} more are in Media.` : '');
      if (items.length > 1 && target == null) {
        const placed = items.slice(0, 3);
        const olds = get().doc.slots.map((s) => s.imageId);
        let dropped = 0;
        step((d) => {
          placed.forEach((it, k) => putImage(d, k, it));
          d.count = placed.length as 1 | 2 | 3;
          arrange(d, d.count, pageMeasure());
          dropped = addMedia(d, items);
        });
        setUi({ selected: 0 });
        toast(`Placed ${placed.length} layouts.${waiting(items.length - placed.length)}${dropped ? ' ' + mediaFull(dropped) : ''}`);
        releaseUnused(olds);
      } else {
        const dropped = placeOne(items[0], target, items.slice(1));
        if (items.length > 1 || dropped) toast(`${waiting(items.length - 1).trim()}${dropped ? ' ' + mediaFull(dropped) : ''}`.trim());
      }
    },
    async addImage(img, target) {
      const item = await ingest(img);
      if (!item) return false;
      const dropped = placeOne(item, target);
      if (dropped) toast(mediaFull(dropped));
      return true;
    },

    async addMediaFiles(files) {
      if (!files.some(isImageFile)) { toast('Use PNG, JPG or WebP images.'); return; }
      const items = await ingestFiles(files);
      if (!items.length) return;
      let dropped = 0;
      step((d) => { dropped = addMedia(d, items); });
      const n = items.length;
      toast(`Added ${n === 1 ? 'an image' : `${n} images`} to Media.${dropped ? ' ' + mediaFull(dropped) : ''}`);
    },
    placeMedia(id, target) {
      const doc = get().doc;
      const item = mediaOf(doc).find((m) => m.imageId === id);
      if (!item) return;
      const { i, added } = slotFor(doc, target);
      if (!added && doc.slots[i].imageId === id) { setUi({ selected: i }); return; }
      const old = doc.slots[i].imageId;
      const fresh = freshlyArranged(doc);
      change((d) => {
        putImage(d, i, item);
        if (added) d.count = (i + 1) as 1 | 2 | 3;
        if (added || fresh) arrange(d, d.count, pageMeasure());
      });
      setUi({ selected: i });
      releaseUnused([old]);
    },
    removeMediaItem(id) {
      if (!removeMedia(clone(get().doc), id)) return;
      change((d) => { removeMedia(d, id); });
    },

    openCapture(target) {
      if (captureOn()) set({ captureDialog: { open: true, target } });
    },
    closeCapture() {
      set({ captureDialog: { ...get().captureDialog, open: false } });
    },
    startCaptureJob(url, target, media = false) {
      const id = ++jobSeq;
      const doc = get().doc;
      const targetId = !media && target != null && target < doc.count ? doc.slots[target].imageId : null;
      set({ captureJobs: [...get().captureJobs, { id, url, target: media ? null : target, targetId, ...(media ? { media } : {}) }] });
      return id;
    },
    endCaptureJob(id) {
      set({ captureJobs: get().captureJobs.filter((j) => j.id !== id) });
    },

    /* --- canvas tools: align and distribute (lib/align.ts) --- */
    align(edge) {
      const { doc, ui } = get();
      const i = ui.selected;
      if (i == null || i >= doc.count || !canAlign(doc)) return;
      if (!alignLayouts(clone(doc), i, edge)) { toast('Already aligned.'); return; }
      change((d) => { alignLayouts(d, i, edge); });
    },
    distribute(axis) {
      const doc = get().doc;
      if (!distributeLayouts(clone(doc), axis)) {
        if (doc.count >= 3) toast('Already evenly spaced.');
        return;
      }
      change((d) => { distributeLayouts(d, axis); });
    },

    /* --- match site colors (output features) --- */
    async matchSiteColors() {
      const { doc, ui } = get();
      const i = ui.selected != null && ui.selected < doc.count ? ui.selected : 0;
      const { imageId } = doc.slots[i];
      const pal = await paletteOf(imageId, loadImage);
      if (!pal) {
        toast(`Couldn’t read the colors of layout ${i + 1}.`);
        return;
      }
      // Decided on the last saved state, which is what the step below changes.
      const { variant, patch } = nextSiteBackground(history.current.background, pal);
      step((d) => { Object.assign(d.background, clone(patch)); });
      const [made, next] = { mesh: ['Mesh', 'a gradient'], gradient: ['Gradient', 'a solid color'], solid: ['Solid color', 'the mesh'] }[variant];
      toast(`${made} from layout ${i + 1}’s colors. Click again for ${next}.`);
    },

    /* --- re-capture and desktop + phone captures (lib/capture/jobs.ts, lib/capture/recapture.ts) --- */
    openRecapture(i) {
      if (captureOn()) set({ captureDialog: { open: true, target: i, recapture: true } });
    },
    async landCapture(img, { targetId, keepFraming = false, avoidId = null }) {
      const item = await ingest(img);
      if (!item) return null;
      const doc = get().doc;
      const visible = (id: string | null) => (id == null ? -1 : doc.slots.findIndex((s, k) => k < doc.count && s.imageId === id));
      const target = visible(targetId);
      const keep = keepFraming && target >= 0;
      const { i, added } = target >= 0 ? { i: target, added: false } : dropSlot(doc, visible(avoidId));
      const old = doc.slots[i].imageId;
      const fresh = !keep && freshlyArranged(doc);
      let dropped = 0;
      step((d) => {
        const prev = clone(d.slots[i]);
        putImage(d, i, item);
        if (keep) Object.assign(d.slots[i], reframe(prev, d.slots[i], d.H));
        if (added) d.count = (i + 1) as 1 | 2 | 3;
        if (added || fresh) arrange(d, d.count, pageMeasure());
        // A re-capture takes the old capture's place in Media.
        dropped = keep ? replaceMedia(d, prev.imageId, item) : addMedia(d, [item]);
      });
      if (!keep) setUi({ selected: i });
      if (dropped) toast(mediaFull(dropped));
      releaseUnused([old]);
      return get().doc.slots[i].imageId;
    },

    putComposition(next) {
      change((d) => {
        for (const k of Object.keys(d) as (keyof Composition)[]) delete d[k];
        Object.assign(d, clone(next));
      });
      setUi({ selected: null });
    },
    async landMedia(img) {
      const item = await ingest(img);
      if (!item) return null;
      const doc = get().doc;
      const sample = doc.slots.findIndex((s, k) => k < doc.count && s.source.kind === 'sample');
      let dropped = 0;
      if (sample >= 0) dropped = placeOne(item, sample);
      else step((d) => { dropped = addMedia(d, [item]); });
      if (dropped) toast(mediaFull(dropped));
      return item.imageId;
    },

    /* --- overlays: headline, badge, watermark (lib/overlays.ts) --- */
    editOverlay(key, patch) {
      edit((d) => patchOverlay(d, key, patch));
    },
    hideOverlays() {
      if (!anyOverlay(get().doc)) return;
      change((d) => {
        if (!d.overlays) return;
        for (const o of Object.values(d.overlays)) o.enabled = false;
      });
    },
    setOverlay(key, patch) {
      change((d) => patchOverlay(d, key, patch));
      const w = get().doc.overlays?.watermark;
      if (key === 'watermark' && ('enabled' in patch || 'kind' in patch) && w?.enabled && w.kind === 'logo' && !w.imageId) toast('Upload a logo, or switch to text.');
    },
    async setWatermarkLogo(file) {
      if (!isImageFile(file)) { toast(NOT_IMAGE); return; }
      const got = await ingestImage(file);
      if (!got) { toast(`Couldn’t read ${file.name}.`); return; }
      const old = get().doc.overlays?.watermark.imageId ?? null;
      step((d) => patchOverlay(d, 'watermark', { enabled: true, kind: 'logo', imageId: got.id, imageName: file.name, nw: got.nw, nh: got.nh }));
      releaseUnused([old]);
    },

    /* --- pin text (lib/pin-text.ts) --- */
    editPinText(field, value) {
      edit((d) => { d.pin = { ...d.pin, [field]: String(value).slice(0, PIN_LIMITS[field]) }; });
    },
    resetPinText(field) {
      if (get().doc.pin?.[field] == null) return;
      change((d) => {
        if (!d.pin) return;
        delete d.pin[field];
        if (!Object.keys(d.pin).length) delete d.pin;
      });
    },

    /* --- projects (lib/projects) --- */
    showProject(doc) {
      clearTimeout(nudgeTimer);
      history = new History(doc);
      set({
        doc: clone(doc),
        guides: { gx: null, gy: null },
        ui: { ...get().ui, selected: null, exportScale: PRESETS[doc.preset].scale, showSafeArea: PRESETS[doc.preset].safe === 'etsy' },
      });
      syncHistory();
    },
  };
});

/* Don't keep what isn't shown: when a change stops showing an image (replace, remove, fewer layouts,
   undo, redo, another background type), or drops a hidden one from the doc, revoke its object URLs and
   drop its decoded copy. The blob stays stored, so showing it again (undo, more layouts) reloads it. */
useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  const shown = shownIds(s.doc), refs = referencedIds(s.doc), was = shownIds(prev.doc);
  referencedIds(prev.doc).forEach((id) => {
    // An image leaving the canvas but still in the doc (the gallery, a hidden layout) keeps its thumbnail.
    if (was.has(id) ? !shown.has(id) : !refs.has(id)) releaseImage(id, refs.has(id));
  });
});

/* Test hook: lets Playwright load a fixed composition, read the store and run the export renderer. */
declare global {
  interface Window {
    __layoutStage?: { store: typeof useEditor; renderComposition: typeof renderComposition; exportComposition: typeof exportComposition };
  }
}
if (typeof window !== 'undefined') window.__layoutStage = { store: useEditor, renderComposition, exportComposition };
