/* The /api/projects logic (lib/projects/server/api.ts) on the local store (fs-store.ts) in a temporary
   folder: list, write with conflict checks, the index kept in step, delete, chunked uploads. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { INDEX_PATH, projectPath } from '@/lib/projects/model';
import { deleteProject, listProjects, parseWrite, readProject, writeProject, type ProjectWrite } from '@/lib/projects/server/api';
import { revisionOf } from '@/lib/projects/model';
import { fsStore, OffsetMismatch, type FsStore } from '@/lib/projects/server/fs-store';
import { PreconditionFailed } from '@/lib/projects/server/store';

const P = 'prj_00000000-aaaa';
const Q = 'prj_11111111-bbbb';
let dir = '';
let store: FsStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ls-projects-'));
  store = fsStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (patch: Partial<ProjectWrite> = {}): ProjectWrite => ({
  baseRev: null, name: 'Pin', createdAt: 1000, updatedAt: 2000, thumbRev: null, images: [], doc: defaultComposition(), ...patch,
});

describe('projects store API', () => {
  it('starts empty, creates a project and lists it', async () => {
    expect(await listProjects(store)).toEqual([]);
    const r = await writeProject(store, P, write({ images: [{ name: 'img_aaaa-1111.png', size: 10 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual({ id: P, name: 'Pin', createdAt: 1000, updatedAt: 2000, rev: await revisionOf('Pin', defaultComposition()), thumbRev: null });
    expect(await listProjects(store)).toEqual([r.project]);
    const f = await readProject(store, P);
    expect(f).toMatchObject({ id: P, name: 'Pin', images: [{ name: 'img_aaaa-1111.png', size: 10 }] });
    expect(f!.doc).toEqual(defaultComposition());
  });

  it('accepts a write based on the current revision and refuses one based on an older one', async () => {
    const a = await writeProject(store, P, write());
    if (!a.ok) throw new Error('create failed');
    const d2 = defaultComposition();
    d2.background.solid = '#123456';
    const b = await writeProject(store, P, write({ baseRev: a.project.rev, doc: d2, updatedAt: 3000 }));
    expect(b.ok).toBe(true);
    // Another device still on the first revision:
    const d3 = defaultComposition();
    d3.background.solid = '#ABCDEF';
    const c = await writeProject(store, P, write({ baseRev: a.project.rev, doc: d3 }));
    expect(c).toEqual({ ok: false, remote: b.ok ? b.project : null });
  });

  it('treats repeating a write (same content) as done, not a conflict', async () => {
    const a = await writeProject(store, P, write());
    const again = await writeProject(store, P, write({ baseRev: null, images: [{ name: 'img_aaaa-1111.png', size: 5 }] }));
    expect(again.ok && a.ok && again.project.rev === a.project.rev).toBe(true);
    expect((await readProject(store, P))!.images).toEqual([{ name: 'img_aaaa-1111.png', size: 5 }]);
  });

  it('reports a deleted project as a conflict with nothing', async () => {
    const a = await writeProject(store, P, write());
    await deleteProject(store, P);
    const d = defaultComposition();
    d.count = 1;
    expect(await writeProject(store, P, write({ baseRev: a.ok ? a.project.rev : null, doc: d }))).toEqual({ ok: false, remote: null });
  });

  it('keeps every project in the index when writes overlap', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `prj_0000000${i}-cccc`);
    await Promise.all(ids.map((id, i) => writeProject(store, id, write({ name: `Pin ${i}` }))));
    expect((await listProjects(store)).map((p) => p.id).sort()).toEqual(ids.sort());
  });

  it('delete removes the project’s files and its index entry', async () => {
    await writeProject(store, P, write());
    await writeProject(store, Q, write({ name: 'Other' }));
    await store.writeChunk(`projects/${P}/images/img_aaaa-1111.png`, 0, 3, new Uint8Array([1, 2, 3]), false);
    await store.writeChunk(`projects/${P}/thumb.jpg`, 0, 2, new Uint8Array([9, 9]), true);
    await deleteProject(store, P);
    expect(await store.list(`projects/${P}/`)).toEqual([]);
    await expect(readFile(path.join(dir, 'projects', P, 'images'))).rejects.toThrow(/ENOENT/); // no empty folders left
    await expect(readFile(path.join(dir, 'projects', P))).rejects.toThrow(/ENOENT/);
    expect((await listProjects(store)).map((p) => p.id)).toEqual([Q]);
    expect(await readProject(store, Q)).not.toBeNull();
  });

  it('rebuilds a lost index from the project files', async () => {
    await writeProject(store, P, write());
    await rm(path.join(dir, ...INDEX_PATH.split('/')));
    expect((await listProjects(store)).map((p) => p.id)).toEqual([P]);
    expect(JSON.parse(await readFile(path.join(dir, ...INDEX_PATH.split('/')), 'utf8')).projects).toHaveLength(1);
  });

  it('validates writes', () => {
    expect(() => parseWrite({ ...write(), name: '   ' })).toThrow();
    expect(() => parseWrite({ ...write(), doc: { nope: 1 } })).toThrow();
    expect(() => parseWrite({ ...write(), thumbRev: 'x' })).toThrow();
    expect(parseWrite({ ...write(), images: [{ name: '../evil', size: 1 }, { name: 'img_aaaa-1111.png', size: 4 }] }).images).toEqual([{ name: 'img_aaaa-1111.png', size: 4 }]);
  });
});

describe('local store', () => {
  it('writes JSON only on the expected version', async () => {
    const e1 = await store.writeJson(projectPath(P), { a: 1 }, null);
    await expect(store.writeJson(projectPath(P), { a: 2 }, null)).rejects.toBeInstanceOf(PreconditionFailed);
    await expect(store.writeJson(projectPath(P), { a: 2 }, 'stale')).rejects.toBeInstanceOf(PreconditionFailed);
    await store.writeJson(projectPath(P), { a: 3 }, e1);
    expect((await store.readJson(projectPath(P)))!.data).toEqual({ a: 3 });
  });

  it('assembles chunked uploads, keeps existing images, refuses a gap', async () => {
    const p = `projects/${P}/images/img_aaaa-1111.png`;
    expect(await store.writeChunk(p, 0, 5, new Uint8Array([1, 2]), false)).toBe('partial');
    await expect(store.writeChunk(p, 3, 5, new Uint8Array([4, 5]), false)).rejects.toBeInstanceOf(OffsetMismatch);
    expect(await store.writeChunk(p, 2, 5, new Uint8Array([3, 4, 5]), false)).toBe('done');
    expect([...(await readFile(path.join(dir, ...p.split('/'))))]).toEqual([1, 2, 3, 4, 5]);
    expect(await store.writeChunk(p, 0, 1, new Uint8Array([7]), false)).toBe('exists');
    const f = await store.read(p);
    expect(f).toMatchObject({ size: 5, type: 'image/png' });
    expect(new Uint8Array(await new Response(f!.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('never leaves its folder', async () => {
    await expect(store.readJson('../outside.json')).rejects.toThrow();
    await expect(store.writeJson('projects/../../x.json', {}, null)).rejects.toThrow();
  });
});
