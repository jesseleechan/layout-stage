/* openStartupProject: leaves unreadable canvases untouched, opens another project instead, and
   keeps new blank projects working without skipping. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultComposition } from '@/lib/arrange';

const mem = vi.hoisted(() => ({ map: new Map<string, unknown>(), failKeys: new Set<string>() }));
vi.mock('@/lib/persist', async (orig) => ({
  ...(await orig<typeof import('@/lib/persist')>()),
  getValue: async (k: string) => (mem.failKeys.has(k) ? undefined : mem.map.get(k)),
  readValue: async (k: string) => (mem.failKeys.has(k) ? { ok: false, value: undefined } : { ok: true, value: mem.map.get(k) }),
  setValue: async (k: string, v: unknown) => { mem.map.set(k, v); return true; },
  deleteValue: async (k: string) => mem.map.delete(k),
  loadComposition: async () => ({ ok: true, doc: null }),
  saveComposition: async () => true,
}));

function seedIndex() {
  mem.map.set('projects', {
    v: 1,
    currentId: 'p_a',
    items: [
      { id: 'p_a', name: 'Shop', createdAt: 1, updatedAt: 2, rev: null, dirty: true },
      { id: 'p_b', name: 'Other', createdAt: 1, updatedAt: 1, rev: null, dirty: true },
    ],
    pendingDeletes: [],
  });
}

beforeEach(() => {
  mem.map.clear();
  mem.failKeys.clear();
  vi.resetModules();
});

describe('openStartupProject', () => {
  it('opens a readable project normally', async () => {
    seedIndex();
    mem.map.set('project:p_a', { ...defaultComposition(), W: 1111 });
    mem.map.set('project:p_b', { ...defaultComposition(), W: 2222 });
    const L = await import('@/lib/projects/local');

    const res = await L.openStartupProject();
    expect(res.ok).toBe(true);
    expect(res.doc?.W).toBe(1111);
    expect(res.skipped).toBeUndefined();
    expect(L.localIndex()!.currentId).toBe('p_a');
  });

  it('skips a stored value that is not a canvas without overwriting it', async () => {
    seedIndex();
    mem.map.set('project:p_a', { nope: true });
    mem.map.set('project:p_b', { ...defaultComposition(), W: 2222 });
    const L = await import('@/lib/projects/local');

    const res = await L.openStartupProject();
    expect(res.ok).toBe(true);
    expect(res.doc?.W).toBe(2222);
    expect(res.skipped).toBe('Shop');
    expect(L.localIndex()!.currentId).toBe('p_b');
    expect(mem.map.get('project:p_a')).toEqual({ nope: true });
  });

  it('skips a project whose read fails without overwriting it', async () => {
    seedIndex();
    const valid = { ...defaultComposition(), W: 1111 };
    mem.map.set('project:p_a', valid);
    mem.map.set('project:p_b', { ...defaultComposition(), W: 2222 });
    mem.failKeys.add('project:p_a');
    const L = await import('@/lib/projects/local');

    const res = await L.openStartupProject();
    expect(res.ok).toBe(true);
    expect(res.doc?.W).toBe(2222);
    expect(res.skipped).toBe('Shop');
    expect(L.localIndex()!.currentId).toBe('p_b');
    expect(mem.map.get('project:p_a')).toEqual(valid);
  });

  it('opens a new blank project with no stored doc as empty without skipping', async () => {
    seedIndex();
    mem.map.set('project:p_b', { ...defaultComposition(), W: 2222 });
    const L = await import('@/lib/projects/local');

    const res = await L.openStartupProject();
    expect(res).toEqual({ ok: true, doc: null });
    expect(res.skipped).toBeUndefined();
    expect(L.localIndex()!.currentId).toBe('p_a');
  });

  it('prunes nothing after skipping an unreadable project', async () => {
    seedIndex();
    mem.map.set('project:p_a', { nope: true });
    mem.map.set('project:p_b', { ...defaultComposition(), W: 2222 });
    const L = await import('@/lib/projects/local');

    await L.openStartupProject();
    expect(await L.localImageIds([])).toBeNull();
  });
});
