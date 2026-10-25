/* Types, defaults, canvas presets and built-in styles. Every number here comes from reference/layout-stage.html. */
import type { Overlays } from './overlays';

export type PresetId = 'pin' | 'etsy43' | 'etsy11' | 'p45' | 'custom';
export type CropId = 'full' | '16:10' | '4:3' | '1:1' | '4:5' | '9:16';
export type ShadowPreset = 'none' | 'soft' | 'lifted' | 'float' | 'hard' | 'custom';
export type BackgroundType = 'solid' | 'gradient' | 'mesh' | 'image';

export interface CaptureOptions {
  width: 1440 | 1280 | 834 | 390;
  fullPage: boolean;
  scale: 1 | 2;
  delayMs: number; // 0–5000
  hideBanners: boolean;
  darkMode: boolean; // capture with prefers-color-scheme: dark
  hideSelectors: string[]; // CSS selectors hidden with display:none (lib/capture/selectors.ts)
}

export type SlotSource =
  | { kind: 'sample' }
  | { kind: 'file' }
  | { kind: 'url'; url: string; capturedAt: string; options: CaptureOptions; needsPassword?: boolean }; // the password itself is never stored

export interface Slot {
  imageId: string; // key into the image store (lib/images.ts)
  name: string; // file name, or hostname + path for captures
  source: SlotSource;
  nw: number;
  nh: number; // natural size in px
  crop: CropId;
  fx: number;
  fy: number; // 0–100, visible part when cropped (CSS object-position %)
  cx: number;
  cy: number; // center, canvas px
  w: number; // width, canvas px; height = w / cropRatio
}

export interface Shadow {
  preset: ShadowPreset;
  blur: number;
  x: number;
  y: number; // units (1/1000 of the canvas's short side)
  opacity: number; // 0–1
  color: string; // #RRGGBB
}

export interface Frame {
  radius: number;
  borderW: number;
  borderC: string;
  shadow: Shadow;
}

export interface Background {
  type: BackgroundType;
  solid: string;
  grad: { a: string; b: string; angle: number }; // CSS angle, degrees
  mesh: [string, string, string, string]; // base + 3 glows
  meshSeed: number;
  imageId: string | null;
  imageName: string;
  blur: number; // units
  dim: number; // 0–0.7
  grain: number; // 0–40
}

export interface Composition {
  preset: PresetId;
  W: number;
  H: number;
  count: 1 | 2 | 3;
  slots: [Slot, Slot, Slot]; // only the first `count` are shown
  order: number[]; // z-order bottom → top, all 3 indices
  frame: Frame;
  background: Background;
  /** Headline, badge and watermark above the layouts (lib/overlays.ts). Absent: none. */
  overlays?: Overlays;
}

/** A style is a frame plus a background, never the images. Built-ins only name the background
 *  fields they change and are merged over the current background, exactly like the prototype. */
export type StyleBackground = Partial<Omit<Background, 'imageId' | 'imageName'>>;
export interface Style {
  name: string;
  frame: Frame;
  background: StyleBackground;
}

export interface UiState {
  selected: number | null;
  showSafeArea: boolean;
  exportFormat: 'png' | 'jpg';
  exportScale: 1 | 2;
}

/* ---------------- canvas presets ---------------- */

export interface Preset {
  label: string;
  w: number;
  h: number;
  scale: 1 | 2; // default export scale
  safe: 'inset' | 'etsy'; // central 80% or Etsy 5:4 thumbnail crop
  slug: string; // used in export file names
}

export const PRESETS: Record<PresetId, Preset> = {
  pin: { label: 'Pinterest pin · 2:3', w: 1000, h: 1500, scale: 2, safe: 'inset', slug: 'pinterest' },
  etsy43: { label: 'Etsy listing · 4:3', w: 3000, h: 2250, scale: 1, safe: 'etsy', slug: 'etsy-4x3' },
  etsy11: { label: 'Etsy listing · 1:1', w: 2000, h: 2000, scale: 1, safe: 'etsy', slug: 'etsy-square' },
  p45: { label: 'Portrait · 4:5', w: 1080, h: 1350, scale: 2, safe: 'inset', slug: 'portrait' },
  custom: { label: 'Custom size…', w: 1000, h: 1500, scale: 1, safe: 'inset', slug: 'custom' },
};
export const PRESET_IDS: PresetId[] = ['pin', 'etsy43', 'etsy11', 'p45', 'custom'];
export const CUSTOM_MIN = 200;
export const CUSTOM_MAX = 6000;
export const EXPORT_MAX_SIDE = 8000;
export const HISTORY_LIMIT = 80;

/* ---------------- crops ---------------- */

export const CROPS: { id: CropId; label: string; ratio: number | null }[] = [
  { id: 'full', label: 'Full', ratio: null },
  { id: '16:10', label: '16:10', ratio: 1.6 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 0.8 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/* ---------------- shadows ---------------- */

export const SHADOWS: Record<Exclude<ShadowPreset, 'custom'>, Pick<Shadow, 'blur' | 'x' | 'y' | 'opacity'>> = {
  none: { blur: 0, x: 0, y: 0, opacity: 0 },
  soft: { blur: 50, x: 0, y: 18, opacity: 0.18 },
  lifted: { blur: 80, x: 0, y: 40, opacity: 0.28 },
  float: { blur: 140, x: 0, y: 80, opacity: 0.38 },
  hard: { blur: 0, x: 14, y: 14, opacity: 1 },
};
export const SHADOW_PRESETS: { id: Exclude<ShadowPreset, 'custom'>; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'soft', label: 'Soft' },
  { id: 'lifted', label: 'Lifted' },
  { id: 'float', label: 'Float' },
  { id: 'hard', label: 'Hard' },
];

/* ---------------- built-in styles ---------------- */

export const STYLES: Style[] = [
  {
    name: 'Blush mesh',
    frame: { radius: 14, borderW: 0, borderC: '#FFFFFF', shadow: { preset: 'lifted', blur: 80, x: 0, y: 40, opacity: 0.28, color: '#4A2533' } },
    background: { type: 'mesh', mesh: ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'], meshSeed: 3, grain: 10 },
  },
  {
    name: 'Gallery white',
    frame: { radius: 10, borderW: 1, borderC: '#E1E1DC', shadow: { preset: 'soft', blur: 50, x: 0, y: 18, opacity: 0.16, color: '#1D1D1B' } },
    background: { type: 'solid', solid: '#F5F5F2', grain: 0 },
  },
  {
    name: 'Midnight',
    frame: { radius: 16, borderW: 1, borderC: '#343B5C', shadow: { preset: 'float', blur: 140, x: 0, y: 80, opacity: 0.55, color: '#000000' } },
    background: { type: 'gradient', grad: { a: '#1B2244', b: '#3B2452', angle: 155 }, grain: 12 },
  },
  {
    name: 'Sage paper',
    frame: { radius: 8, borderW: 0, borderC: '#FFFFFF', shadow: { preset: 'soft', blur: 50, x: 0, y: 18, opacity: 0.22, color: '#2E3A28' } },
    background: { type: 'solid', solid: '#DCE3D2', grain: 24 },
  },
  {
    name: 'Poster',
    frame: { radius: 6, borderW: 4, borderC: '#16161A', shadow: { preset: 'hard', blur: 0, x: 14, y: 14, opacity: 1, color: '#16161A' } },
    background: { type: 'solid', solid: '#FFD54A', grain: 0 },
  },
  {
    name: 'Dusk',
    frame: { radius: 18, borderW: 0, borderC: '#FFFFFF', shadow: { preset: 'lifted', blur: 80, x: 0, y: 40, opacity: 0.45, color: '#140A1E' } },
    background: { type: 'mesh', mesh: ['#2A1838', '#F08A6C', '#7C4DA6', '#F5C27A'], meshSeed: 7, grain: 14 },
  },
];

/* ---------------- background swatches ---------------- */

export const SOLIDS = ['#FFFFFF', '#F5F5F2', '#EDE7DF', '#F8E1DA', '#FCD5C0', '#FFD54A', '#DCE3D2', '#CDE2EE', '#DAD3F3', '#2B2F3A', '#1B2244', '#3B2A2F'];
export const GRADS: [string, string, number][] = [
  ['#FFE6C7', '#FF9A8B', 160], ['#E3F2EA', '#94C4AE', 145], ['#CDD6FF', '#F6D0FA', 125], ['#FCEBC0', '#F2A65A', 180], ['#F7F4EE', '#E3D6C2', 180],
  ['#FFDDE1', '#EE9CA7', 135], ['#D7ECFF', '#7FA8E6', 160], ['#1B2244', '#3B2452', 155], ['#0F2027', '#2C5364', 150], ['#2A1B12', '#7A3E1E', 165],
];
export const MESHES: [string, string, string, string][] = [
  ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'], ['#EEF4EE', '#B7D3C1', '#F2E2B8', '#9DB8D9'], ['#FFF4E6', '#FFB38A', '#FF7A7A', '#FFD58A'],
  ['#F3F0FF', '#B9A7FF', '#8FD3FF', '#FFC2E2'], ['#2A1838', '#F08A6C', '#7C4DA6', '#F5C27A'], ['#0E1B2C', '#2F6FA7', '#53B6A6', '#1E2E57'],
];

/* ---------------- capture ---------------- */

export const CAPTURE_WIDTHS: { width: CaptureOptions['width']; label: string }[] = [
  { width: 1440, label: 'Desktop 1440' },
  { width: 1280, label: 'Laptop 1280' },
  { width: 834, label: 'Tablet 834' },
  { width: 390, label: 'Phone 390' },
];
export const DEFAULT_CAPTURE: CaptureOptions = { width: 1440, fullPage: true, scale: 2, delayMs: 1500, hideBanners: true, darkMode: false, hideSelectors: [] };

/* ---------------- samples ---------------- */

export const SAMPLE_IDS = ['sample:juniper', 'sample:northbeam', 'sample:fieldnote'] as const;
export const SAMPLE_NAMES = ['Juniper & Co.', 'Northbeam', 'Fieldnote Coffee'];
export const SAMPLE_W = 1440;
export const SAMPLE_H = 2560;
export const isSampleId = (id: string) => id.startsWith('sample:');

/* ---------------- defaults ---------------- */

export const clone = <T>(o: T): T => (o == null ? o : (JSON.parse(JSON.stringify(o)) as T));

export function sampleSlot(i: number): Slot {
  return {
    imageId: SAMPLE_IDS[i], name: SAMPLE_NAMES[i], source: { kind: 'sample' }, nw: SAMPLE_W, nh: SAMPLE_H,
    crop: '16:10', fx: 50, fy: 0, cx: 500, cy: 750, w: 700,
  };
}

export function defaultBackground(): Background {
  return {
    type: 'mesh', solid: '#F5F5F2', grad: { a: '#FFE6C7', b: '#FF9A8B', angle: 160 }, mesh: ['#FBEDEA', '#F4B6C2', '#F7D9A8', '#C7D7F5'],
    meshSeed: 3, imageId: null, imageName: '', blur: 0, dim: 0, grain: 10,
  };
}

/** Applies a style in place: the frame is replaced, the background fields it names are merged in. */
export function applyStyleTo(doc: Composition, st: Style): void {
  doc.frame = clone(st.frame);
  Object.assign(doc.background, clone(st.background));
}

export function defaultUi(): UiState {
  return { selected: 0, showSafeArea: false, exportFormat: 'png', exportScale: PRESETS.pin.scale };
}
