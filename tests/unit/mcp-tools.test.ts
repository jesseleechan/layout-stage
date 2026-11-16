/* MCP tools on the local store (fsStore in a temp folder) with a fake capture returning a tiny PNG. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureError } from '@/lib/capture/errors';
import { makeIhdr, writePng } from '@/lib/capture/png';
import type { CaptureResult } from '@/lib/capture/server';
import { draftTools } from '@/lib/mcp/tools';
import { sanitizeComposition } from '@/lib/persist';
import { listProjects, readProject, writeProject } from '@/lib/projects/server/api';
import { fsStore, type FsStore } from '@/lib/projects/server/fs-store';

// Valid 1x1 RGBA PNG built once for fake captures.
const TINY_PNG = writePng(makeIhdr(1, 1, 8, 6), deflateSync(Buffer.from([0, 0, 0, 0, 0])));

let dir = '';
let store: FsStore;
let tick = 1_700_000_000_000;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ls-mcp-'));
  store = fsStore(dir);
  tick = 1_700_000_000_000;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeTools(capture?: () => Promise<CaptureResult>) {
  let n = 0;
  return draftTools({
    store,
    now: () => (tick += 1000),
    capture: capture ?? (async (input) => {
      n++;
      return {
        images: [{ type: 'image/png', data: TINY_PNG }],
        trimmed: false,
        finalUrl: `${input.url.replace(/\/$/, '')}/p${n}`,
      };
    }),
  });
}

describe('mcp tools', () => {
  it('lists options, creates a project, and lists it', async () => {
    const tools = makeTools();
    const opts = tools.listOptions();
    expect(opts).toContain('Pinterest pin');
    expect(opts).toContain('Bento');
    expect(opts).toContain('Midnight');

    const created = await tools.createProject({ name: 'Spring Pin', canvas: 'pin' });
    expect(created).toContain('Spring Pin');
    expect(created.length).toBeLessThan(4000);
    const list = await tools.listProjects();
    expect(list).toContain('Spring Pin');
    const projects = await listProjects(store);
    expect(projects).toHaveLength(1);
  });

  it('adds 3 pages to layouts and a 4th to Media, keeping stored images and valid doc', async () => {
    const tools = makeTools();
    await tools.createProject({ name: 'Multi' });
    const [p] = await listProjects(store);

    const r1 = await tools.addPage({ project: p.id, url: 'https://example.com' });
    const r2 = await tools.addPage({ project: p.id, url: 'https://example.com' });
    const r3 = await tools.addPage({ project: p.id, url: 'https://example.com' });
    const r4 = await tools.addPage({ project: p.id, url: 'https://example.com' });

    expect(r1).toContain('layout 1');
    expect(r2).toContain('layout 2');
    expect(r3).toContain('layout 3');
    expect(r4).toContain('Media');

    for (const r of [r1, r2, r3, r4]) {
      expect(r.length).toBeLessThan(4000);
      expect(r).not.toContain('PNG');
    }

    const storedFiles = await store.list(`projects/${p.id}/images/`);
    expect(storedFiles).toHaveLength(4);
    const file = await readProject(store, p.id);
    expect(file).not.toBeNull();
    expect(file!.images).toHaveLength(4);
    expect(sanitizeComposition(file!.doc)).not.toBeNull();
  });

  it('returns plain sentences on expected errors without changing the store', async () => {
    const tools = makeTools(async () => {
      throw new CaptureError('timeout');
    });
    await tools.createProject({ name: 'Safe' });
    const [p] = await listProjects(store);
    const before = await readProject(store, p.id);

    expect(await tools.getProject('prj_00000000-0000')).toContain('no project');
    expect(await tools.addPage({ project: p.id, url: 'ftp://example.com' })).not.toBe('');
    expect(await tools.addPage({ project: p.id, url: 'https://example.com' })).toContain('30 seconds');
    expect(await tools.createProject({ name: 'Bad', look: 'NotALook' })).toContain('no look');

    const after = await readProject(store, p.id);
    expect(after!.rev).toBe(before!.rev);
    expect(await store.list(`projects/${p.id}/images/`)).toEqual([]);
  });

  it('reports a conflict when the project changed between read and write', async () => {
    let projectId = '';
    const tools = draftTools({
      store,
      now: () => (tick += 1000),
      capture: async () => {
        // Mutate the project between readProject and writeProject.
        const file = await readProject(store, projectId);
        const doc2 = sanitizeComposition(file!.doc)!;
        doc2.background.solid = '#112233';
        await writeProject(store, projectId, {
          baseRev: file!.rev,
          name: file!.name,
          createdAt: file!.createdAt,
          updatedAt: tick + 500,
          thumbRev: file!.thumbRev,
          images: file!.images,
          doc: doc2,
        });
        return {
          images: [{ type: 'image/png', data: TINY_PNG }],
          trimmed: false,
          finalUrl: 'https://example.com',
        };
      },
    });
    await tools.createProject({ name: 'Race' });
    const [p] = await listProjects(store);
    projectId = p.id;

    const msg = await tools.addPage({ project: p.id, url: 'https://example.com' });
    expect(msg).toContain('changed in the editor');
  });

  it('updates layout arrangement and canvas via setLayout', async () => {
    const tools = makeTools();
    await tools.createProject({ name: 'Reorg' });
    const [p] = await listProjects(store);

    const out = await tools.setLayout({ project: p.id, layouts: 3, layout: 'Bento', canvas: 'etsy43' });
    expect(out).toContain('Etsy listing');
    expect(out).toContain('Bento');
    expect(out.length).toBeLessThan(4000);

    const file = await readProject(store, p.id);
    const doc = sanitizeComposition(file!.doc)!;
    expect(doc.preset).toBe('etsy43');
    expect(doc.count).toBe(3);
    expect(doc.arrangement).toBe('grid');
  });
});
