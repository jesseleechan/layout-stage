/* Switching projects in lib/projects/local.ts: currentId and the editor's canvas update in the
   same tick, so an autosave during a slow IndexedDB write lands in the new project. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import type { Composition } from '@/lib/model';

const mem = vi.hoisted(() => ({ map: new Map<string, unknown>(), hold: null as Promise<void> | null }));
vi.mock('@/lib/persist', async (orig) => ({
  ...(await orig<typeof import('@/lib/persist')>()),
  getValue: async (k: string) => mem.map.get(k),
  setValue: async (k: string, v: unknown) => {
    if (k === 'projects' && mem.hold) await mem.hold;
    mem.map.set(k, v);
    return true;
  },
  deleteValue: async (k: string) => mem.map.delete(k),
  loadComposition: async () => ({ ok: true, doc: null }),
  saveComposition: async () => true,
}));

beforeEach(() => {
  mem.map.clear();
  mem.hold = null;
  vi.resetModules();
});

describe('switchOpenProject', () => {
  it('shows the canvas in the same tick as the id change', async () => {
    const L = await import('@/lib/projects/local');
    await L.openStartupProject();
    await L.addLocalProject({ id: 'p_b', name: 'B' }, defaultComposition());

    let release!: () => void;
    mem.hold = new Promise<void>((res) => { release = res; });

    let shown = false;
    const done = L.switchOpenProject('p_b', () => { shown = true; });
    await vi.waitFor(() => expect(L.localIndex()!.currentId).toBe('p_b'));
    expect(shown).toBe(true);

    release();
    expect(await done).toBe(true);
  });

  it('autosave during the held write goes to the new project with the new canvas', async () => {
    const L = await import('@/lib/projects/local');
    await L.openStartupProject();
    const firstId = L.localIndex()!.currentId;
    const firstDoc = await L.readDoc(firstId);
    await L.addLocalProject({ id: 'p_b', name: 'B' }, defaultComposition());

    let release!: () => void;
    mem.hold = new Promise<void>((res) => { release = res; });

    let current!: Composition;
    const done = L.switchOpenProject('p_b', () => {
      current = { ...defaultComposition(), W: 1234 };
    });
    await vi.waitFor(() => expect(L.localIndex()!.currentId).toBe('p_b'));
    const saved = L.saveOpenProject(current);

    release();
    await Promise.all([done, saved]);

    expect((await L.readDoc('p_b'))?.W).toBe(1234);
    expect(await L.readDoc(firstId)).toEqual(firstDoc);
  });

  it('still shows the canvas when storage has no index', async () => {
    const L = await import('@/lib/projects/local');
    let shown = false;
    const ok = await L.switchOpenProject('x', () => { shown = true; });
    expect(ok).toBe(false);
    expect(shown).toBe(true);
  });
});
