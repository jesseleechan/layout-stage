/* The Claude connector's tool logic: lists options and projects, creates drafts, captures and places
   pages, and updates layouts on any ProjectStore and capture function. Server only. */
import { randomUUID } from 'node:crypto';
import { ARRANGEMENT_NAMES, presetArrangements } from '../arrange';
import { CaptureError } from '../capture/errors';
import { parseCaptureRequest } from '../capture/options';
import { readPng } from '../capture/png';
import type { CaptureInput, CaptureResult } from '../capture/server';
import { captureOn } from '../capture/switch';
import { DEFAULT_CAPTURE, PRESETS, STYLES, type MediaItem } from '../model';
import { sanitizeComposition } from '../persist';
import { cleanName, imageFileName, imagePath, newProjectId } from '../projects/model';
import { BadRequest, listProjects as listStoredProjects, readProject, writeProject } from '../projects/server/api';
import type { ProjectStore } from '../projects/server/store';
import { addPageTo, CANVASES, describe, DraftError, newDraft, setLayout as setDraftLayout, type CanvasId } from './draft';

export interface ToolDeps {
  store: ProjectStore;
  capture(input: CaptureInput): Promise<CaptureResult>;
  now(): number;
}

const seeLine = (name: string) => `Open Layout Stage → Projects → “${name}” to see it. I can’t see the image.`;

/** The layout name for a capture: hostname + path, without a trailing slash, query or hash. */
function captureName(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, '');
    try {
      p = decodeURI(p);
    } catch {
      /* keep it encoded */
    }
    return u.hostname + p;
  } catch {
    return url;
  }
}

function checkCanvas(canvas: string | undefined): CanvasId | undefined {
  if (canvas == null) return undefined;
  if (!(CANVASES as readonly string[]).includes(canvas)) {
    throw new DraftError(`Unknown canvas size “${canvas}”. Available: ${CANVASES.join(', ')}.`);
  }
  return canvas as CanvasId;
}

async function runGuarded(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DraftError || e instanceof BadRequest || e instanceof CaptureError) {
      return e.message;
    }
    console.error('[mcp]', e instanceof Error ? e.message : 'unexpected error');
    return 'Something went wrong on the server. Try again in a moment.';
  }
}

/** Builds the six MCP tool handlers against a project store and capture function. */
export function draftTools(deps: ToolDeps) {
  return {
    listOptions(): string {
      const canvases = CANVASES.map((id) => `  ${id}: ${PRESETS[id].label} (${PRESETS[id].w}×${PRESETS[id].h})`);
      const layouts = ([1, 2, 3] as const).map(
        (n) => `  ${n} ${n === 1 ? 'layout' : 'layouts'}: ${presetArrangements(n).map((a) => ARRANGEMENT_NAMES[a][n]).join(', ')}`,
      );
      const looks = STYLES.map((s) => s.name).join(', ');
      return [
        'Canvas sizes:',
        ...canvases,
        'Layout presets:',
        ...layouts,
        `Looks: ${looks}`,
      ].join('\n');
    },

    listProjects(): Promise<string> {
      return runGuarded(async () => {
        const list = (await listStoredProjects(deps.store))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 50);
        if (!list.length) return 'No projects yet.';
        return list.map((p) => `${p.id} — ${p.name} (${new Date(p.updatedAt).toISOString()})`).join('\n');
      });
    },

    getProject(id: string): Promise<string> {
      return runGuarded(async () => {
        const file = await readProject(deps.store, id);
        if (!file) return 'There is no project with that id.';
        const doc = sanitizeComposition(file.doc);
        if (!doc) return 'That project’s canvas couldn’t be read.';
        return `${describe(doc, file.name)}\n\n${seeLine(file.name)}`;
      });
    },

    createProject(input: { name: string; canvas?: string; look?: string }): Promise<string> {
      return runGuarded(async () => {
        const name = cleanName(input.name);
        if (!name) return 'A project needs a name.';
        const canvas = checkCanvas(input.canvas) ?? 'pin';
        const doc = newDraft(canvas, input.look);
        const id = newProjectId();
        const now = deps.now();
        const res = await writeProject(deps.store, id, {
          baseRev: null, name, createdAt: now, updatedAt: now, thumbRev: null, images: [], doc,
        });
        if (!res.ok) return 'Couldn’t create the project. Try again in a moment.';
        return `Created project “${name}” (${id}).\n${seeLine(name)}`;
      });
    },

    addPage(input: { project: string; url: string; device?: string; fullPage?: boolean }): Promise<string> {
      return runGuarded(async () => {
        if (!captureOn()) return 'Capture is switched off on this deployment, so pages can’t be added.';
        const file = await readProject(deps.store, input.project);
        if (!file) return 'There is no project with that id.';
        const doc = sanitizeComposition(file.doc);
        if (!doc) return 'That project’s canvas couldn’t be read.';
        const device = input.device ?? 'desktop';
        if (device !== 'desktop' && device !== 'phone') return 'Device must be desktop or phone.';
        const fullPage = input.fullPage ?? true;
        const parsed = parseCaptureRequest({
          url: input.url,
          ...DEFAULT_CAPTURE,
          width: device === 'phone' ? 390 : 1440,
          scale: 1,
          fullPage,
        });
        const { images, trimmed, finalUrl } = await deps.capture(parsed);
        if (images.length !== 1 || images[0].type !== 'image/png') {
          return 'Expected a single PNG capture.';
        }
        const { width, height } = readPng(images[0].data);
        const imageId = `img_${randomUUID()}`;
        const fileName = imageFileName(imageId, 'image/png');
        await deps.store.writeFile(imagePath(input.project, fileName), images[0].data, 'image/png');

        const now = deps.now();
        const item: MediaItem = {
          imageId,
          name: captureName(finalUrl),
          source: {
            kind: 'url',
            url: parsed.url,
            capturedAt: new Date(now).toISOString(),
            options: {
              width: parsed.width,
              fullPage: parsed.fullPage,
              scale: parsed.scale,
              delayMs: parsed.delayMs,
              hideBanners: parsed.hideBanners,
              darkMode: parsed.darkMode,
              hideSelectors: parsed.hideSelectors,
            },
          },
          nw: width,
          nh: height,
        };
        const placed = addPageTo(doc, item);
        const res = await writeProject(deps.store, input.project, {
          baseRev: file.rev,
          name: file.name,
          createdAt: file.createdAt,
          updatedAt: now,
          thumbRev: file.thumbRev,
          images: [{ name: fileName, size: images[0].data.byteLength }],
          doc,
        });
        if (!res.ok) return `“${file.name}” was changed in the editor just now. Run this again.`;
        const where = placed.where === 'layout' ? `layout ${placed.index + 1}` : 'Media';
        const note = trimmed ? ' (trimmed to the capture height limit)' : '';
        return `Added ${item.name} (${width}×${height}${note}) to ${where}.\n${seeLine(file.name)}`;
      });
    },

    setLayout(input: { project: string; layouts?: number; layout?: string; canvas?: string; look?: string }): Promise<string> {
      return runGuarded(async () => {
        const file = await readProject(deps.store, input.project);
        if (!file) return 'There is no project with that id.';
        const doc = sanitizeComposition(file.doc);
        if (!doc) return 'That project’s canvas couldn’t be read.';
        const canvas = checkCanvas(input.canvas);
        setDraftLayout(doc, {
          layouts: input.layouts,
          layout: input.layout,
          canvas,
          look: input.look,
        });
        const res = await writeProject(deps.store, input.project, {
          baseRev: file.rev,
          name: file.name,
          createdAt: file.createdAt,
          updatedAt: deps.now(),
          thumbRev: file.thumbRev,
          images: file.images,
          doc,
        });
        if (!res.ok) return `“${file.name}” was changed in the editor just now. Run this again.`;
        return `${describe(doc, file.name)}\n\n${seeLine(file.name)}`;
      });
    },
  };
}
