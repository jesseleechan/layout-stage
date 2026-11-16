/* Pure canvas building for the Claude connector (MCP): creates new draft canvases, places captured
   pages into layouts or Media, updates canvas/layout/look, and formats a text summary. Pure: runs on
   the server and in unit tests without browser or store access. */
import {
  applyArrangement, arrange, ARRANGEMENT_NAMES, arrangementOf, defaultComposition, presetArrangements, presetOf,
} from '../arrange';
import { resizeCanvas } from '../canvas-size';
import { addMedia, putImage, slotFor } from '../media';
import { applyStyleTo, PRESETS, STYLES, type Composition, type MediaItem } from '../model';

export const CANVASES = ['pin', 'story', 'etsy43', 'etsy11', 'p45'] as const;
export type CanvasId = (typeof CANVASES)[number];

export class DraftError extends Error {}

function findLook(name: string) {
  const q = name.trim().toLowerCase();
  const look = STYLES.find((s) => s.name.toLowerCase() === q);
  if (!look) {
    throw new DraftError(`There is no look called “${name}”. Available looks: ${STYLES.map((s) => s.name).join(', ')}.`);
  }
  return look;
}

/** A new draft composition for `canvas` (default `pin`), optionally styled with a named look. */
export function newDraft(canvas: CanvasId = 'pin', lookName?: string): Composition {
  const doc = defaultComposition();
  if (canvas !== 'pin') resizeCanvas(doc, PRESETS[canvas].w, PRESETS[canvas].h, null, canvas);
  if (lookName) applyStyleTo(doc, findLook(lookName));
  return doc;
}

/** Places a captured page in the first sample layout or a new layout (up to 3), else in Media. */
export function addPageTo(doc: Composition, item: MediaItem): { where: 'layout'; index: number } | { where: 'media' } {
  const hasRoom = doc.count < 3 || doc.slots.slice(0, doc.count).some((s) => s.source.kind === 'sample');
  if (hasRoom) {
    const { i, added } = slotFor(doc, null);
    putImage(doc, i, item);
    if (added) doc.count = (i + 1) as 1 | 2 | 3;
    arrange(doc, doc.count, null);
    addMedia(doc, [item]);
    return { where: 'layout', index: i };
  }
  addMedia(doc, [item]);
  return { where: 'media' };
}

/** Applies canvas, layout count, layout preset name, and look in order. */
export function setLayout(
  doc: Composition,
  opts: { layouts?: number; layout?: string; canvas?: CanvasId; look?: string },
): void {
  if (opts.canvas && opts.canvas !== doc.preset) {
    const p = PRESETS[opts.canvas];
    resizeCanvas(doc, p.w, p.h, null, opts.canvas);
  }
  let layoutsChanged = false;
  if (opts.layouts != null) {
    if (opts.layouts !== 1 && opts.layouts !== 2 && opts.layouts !== 3) {
      throw new DraftError('Layouts must be 1, 2, or 3.');
    }
    if (opts.layouts !== doc.count) {
      doc.count = opts.layouts;
      layoutsChanged = true;
    }
  }
  if (opts.layout) {
    const offered = presetArrangements(doc.count);
    const q = opts.layout.trim().toLowerCase();
    const found = offered.find((a) => ARRANGEMENT_NAMES[a][doc.count].toLowerCase() === q);
    if (!found) {
      const names = offered.map((a) => ARRANGEMENT_NAMES[a][doc.count]).join(', ');
      throw new DraftError(`There is no layout called “${opts.layout}” for ${doc.count} ${doc.count === 1 ? 'layout' : 'layouts'}. Available: ${names}.`);
    }
    applyArrangement(doc, found, null);
  } else if (layoutsChanged) {
    arrange(doc, doc.count, null);
  }
  if (opts.look) applyStyleTo(doc, findLook(opts.look));
}

/** A concise text summary of a draft project for Claude. */
export function describe(doc: Composition, name: string): string {
  const preset = PRESETS[doc.preset];
  const layoutName = ARRANGEMENT_NAMES[presetOf(arrangementOf(doc), doc.count)][doc.count];
  const shownIds = new Set(doc.slots.slice(0, doc.count).map((s) => s.imageId));
  const lines = [
    `Project: ${name}`,
    `Canvas: ${preset.label} (${doc.W}×${doc.H})`,
    `Layouts: ${doc.count} (${layoutName})`,
  ];
  for (let i = 0; i < doc.count; i++) {
    const s = doc.slots[i];
    const origin = s.source.kind === 'url' ? s.source.url : s.source.kind === 'sample' ? 'sample' : 'uploaded';
    lines.push(`  ${i + 1}. ${s.name} (${origin})`);
  }
  const waiting = (doc.media ?? []).filter((m) => !shownIds.has(m.imageId));
  if (waiting.length) {
    lines.push(`Media (not shown): ${waiting.map((m) => m.name).join(', ')}`);
  }
  lines.push(`Background: ${doc.background.type}`);
  return lines.join('\n');
}
