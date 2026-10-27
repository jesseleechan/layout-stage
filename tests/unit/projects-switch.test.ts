/* PROJECTS_SYNC=off: no project store, even with a Blob store connected, so projects stay in each
   browser and Vercel Blob is never called. */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/projects/server/blob-store', () => ({
  blobStore: () => {
    throw new Error('Vercel Blob was used');
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The store module afresh: projectStore() keeps the store it picked. */
const storeModule = () => import('@/lib/projects/server/store');

describe('PROJECTS_SYNC=off', () => {
  it('turns sync off even with a Blob token', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test');
    expect((await storeModule()).storeKind()).toBe('blob');
    vi.resetModules();
    vi.stubEnv('PROJECTS_SYNC', 'off');
    const m = await storeModule();
    expect(m.storeKind()).toBeNull();
    expect(await m.projectStore()).toBeNull();
  });

  it('the projects list says sync is off', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test');
    vi.stubEnv('PROJECTS_SYNC', 'off');
    const { GET } = await import('@/app/api/projects/route');
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sync: 'off', projects: [] });
  });

  it('any other value leaves the store as it was', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('PROJECTS_SYNC', 'on');
    expect((await storeModule()).storeKind()).toBe('local');
  });
});
