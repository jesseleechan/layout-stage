/* A project as one file: a stored ZIP with project.json (the name and the canvas) and the canvas's
   images under images/, named as sync names them. Download keeps a backup or hands a project on;
   Open brings one in as a new project. What a file holds is untrusted: the canvas goes through the
   sanitizer and only images the canvas uses are taken. Pure apart from Blob. */
import type { Composition } from '../model';
import { sanitizeComposition } from '../persist';
import { readStoredZip, zipBlobs } from '../zip';
import { cleanName, fileType, imageFileName, imageIdOf, MAX_IMAGE_BYTES, projectImageIds } from './model';

export const PROJECT_FILE_EXT = '.layoutstage.zip';
const MANIFEST = 'project.json';
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

/** "My shop — pin 2" → "my-shop-pin-2.layoutstage.zip". */
export function projectFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
  return `${slug || 'project'}${PROJECT_FILE_EXT}`;
}

/** The project as a file. `missing` counts images this browser doesn't have (the file is made anyway). */
export async function packProject(
  name: string,
  doc: Composition,
  getBlob: (id: string) => Promise<Blob | null>,
): Promise<{ file: Blob; missing: number }> {
  const entries: { name: string; blob: Blob }[] = [
    { name: MANIFEST, blob: new Blob([JSON.stringify({ app: 'layout-stage', v: 1, name, doc })], { type: 'application/json' }) },
  ];
  let missing = 0;
  for (const id of projectImageIds(doc)) {
    const blob = await getBlob(id);
    if (!blob) {
      missing++;
      continue;
    }
    entries.push({ name: `images/${imageFileName(id, blob.type)}`, blob });
  }
  return { file: await zipBlobs(entries), missing };
}

export interface OpenedProject {
  name: string;
  doc: Composition;
  images: { id: string; blob: Blob }[];
  /** Images the canvas uses that the file doesn't hold. */
  missing: number;
}

/** Reads a project file; null when it isn't one (not a zip of ours, no usable canvas). */
export async function unpackProject(file: Blob): Promise<OpenedProject | null> {
  try {
    const entries = await readStoredZip(file);
    const manifest = entries.find((e) => e.name === MANIFEST);
    if (!manifest || manifest.blob.size > MAX_MANIFEST_BYTES) return null;
    const parsed = JSON.parse(await manifest.blob.text()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.app !== 'layout-stage' || parsed.v !== 1) return null;
    const doc = sanitizeComposition(parsed.doc);
    if (!doc) return null;
    const name = cleanName(typeof parsed.name === 'string' ? parsed.name : '') || 'Opened project';

    const wanted = new Set(projectImageIds(doc));
    const seen = new Set<string>();
    const images: { id: string; blob: Blob }[] = [];
    for (const entry of entries) {
      if (!entry.name.startsWith('images/')) continue;
      const base = entry.name.slice('images/'.length);
      if (base.includes('/')) continue;
      const id = imageIdOf(base);
      if (!id || !wanted.has(id) || seen.has(id)) continue;
      if (entry.blob.size <= 0 || entry.blob.size > MAX_IMAGE_BYTES) continue;
      seen.add(id);
      images.push({ id, blob: entry.blob.slice(0, entry.blob.size, fileType(base)) });
    }
    const missing = [...wanted].filter((id) => !seen.has(id)).length;
    return { name, doc, images, missing };
  } catch {
    return null;
  }
}
