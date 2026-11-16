/* Storage-failure warning in lib/store.ts: warns once per session when autosave or image storage
   fails, and stays silent when storage works or a mock omits `stored`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ saveOk: true, stored: true as boolean | undefined, n: 0 }));
vi.mock('@/lib/images', () => ({
  ingestImage: async () => ({ id: `img_${++io.n}`, nw: 1440, nh: 4000, ...(io.stored === undefined ? {} : { stored: io.stored }) }),
  loadImage: async () => null,
  releaseImage: () => {},
  pruneImages: async () => {},
}));
vi.mock('@/lib/projects/local', () => ({
  openStartupProject: async () => ({ ok: true, doc: null }),
  saveOpenProject: async () => io.saveOk,
  localImageIds: async () => null,
}));
vi.mock('@/lib/persist', async (orig) => ({ ...(await orig<typeof import('@/lib/persist')>()), loadStyles: async () => [], saveStyles: async () => true }));

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  io.saveOk = true;
  io.stored = true;
  io.n = 0;
  vi.resetModules();
});

describe('storage failure warning', () => {
  it('stays silent when autosave works', async () => {
    const { useEditor } = await import('@/lib/store');
    await useEditor.getState().init();
    await settle();
    expect(useEditor.getState().toast).toBeNull();
  });

  it('warns once per session when autosave fails', async () => {
    io.saveOk = false;
    const { useEditor } = await import('@/lib/store');
    const S = () => useEditor.getState();
    await S().init();
    await settle();
    expect(S().toast?.msg).toMatch(/couldn’t save/);

    useEditor.setState({ toast: null });
    S().setCount(S().doc.count === 1 ? 2 : 1);
    await settle();
    expect(S().toast).toBeNull();
  });

  it('warns when an image could not be stored', async () => {
    io.stored = false;
    const { useEditor } = await import('@/lib/store');
    const S = () => useEditor.getState();
    await S().init();
    await S().landMedia({ blob: new Blob(['x'], { type: 'image/png' }), name: 'a.png', source: { kind: 'file' } });
    expect(S().toast?.msg).toMatch(/couldn’t save/);
  });

  it('does not warn when stored is omitted', async () => {
    io.stored = undefined;
    const { useEditor } = await import('@/lib/store');
    const S = () => useEditor.getState();
    await S().init();
    await S().landMedia({ blob: new Blob(['x'], { type: 'image/png' }), name: 'a.png', source: { kind: 'file' } });
    expect(S().toast?.msg ?? '').not.toMatch(/couldn’t save/);
  });
});
