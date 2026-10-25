/* The Vercel Blob store module (lib/projects/server/blob-store.ts) with the real SDK, offline: client
   upload tokens are signed locally from a (fake) read-write token, and presigned download URLs are
   signed locally from a delegation; only issueSignedToken (a network call) is replaced. What only a
   real store can show (uploads landing, the URLs answering) is checked on a Vercel preview. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPayloadFromClientToken } from '@vercel/blob/client';

const issued = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@vercel/blob', async (orig) => {
  const real = await orig<typeof import('@vercel/blob')>();
  return {
    ...real,
    issueSignedToken: vi.fn(async (o: { operations?: string[]; validUntil?: number }) => {
      issued.calls++;
      const validUntil = o.validUntil ?? Date.now() + 3600_000;
      const payload = Buffer.from(JSON.stringify({ storeId: 'store_teststore123', pathname: '*', operations: o.operations, validUntil })).toString('base64url');
      return { delegationToken: `${payload}.sig`, clientSigningToken: 'signing-key', validUntil };
    }),
  };
});

import { blobStore, handleClientUpload } from '@/lib/projects/server/blob-store';

const P = 'prj_00000000-aaaa';
const req = () => new Request('http://localhost/api/projects/upload', { method: 'POST' });
const ask = (pathname: string) =>
  handleClientUpload(req(), { type: 'blob.generate-client-token', payload: { pathname, multipart: false, clientPayload: null } });

let saved: string | undefined;
beforeAll(() => {
  saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore123_notarealsecret';
});
afterAll(() => {
  if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved;
});

describe('client upload tokens', () => {
  it('an image: its own pathname, image types, 100 MB, never overwritten', async () => {
    const pathname = `projects/${P}/images/img_aaaa-1111.png`;
    const { clientToken } = await ask(pathname);
    expect(clientToken.startsWith('vercel_blob_client_teststore123_')).toBe(true);
    const t = getPayloadFromClientToken(clientToken);
    expect(t).toMatchObject({ pathname, allowedContentTypes: ['image/*'], maximumSizeInBytes: 100 * 1024 * 1024, allowOverwrite: false, addRandomSuffix: false });
    expect(t.validUntil).toBeGreaterThan(Date.now());
    expect(t.validUntil).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
    expect(t).not.toHaveProperty('onUploadCompleted');
  });

  it('the thumbnail: JPEG only, small, replaced as the canvas changes', async () => {
    const t = getPayloadFromClientToken((await ask(`projects/${P}/thumb.jpg`)).clientToken);
    expect(t).toMatchObject({ allowedContentTypes: ['image/jpeg'], maximumSizeInBytes: 512 * 1024, allowOverwrite: true, cacheControlMaxAge: 60 });
  });

  it('nothing else', async () => {
    for (const p of [`projects/${P}/project.json`, 'projects/index.json', 'chromium.tar', `projects/${P}/images/x.html`]) await expect(ask(p), p).rejects.toThrow();
    await expect(handleClientUpload(req(), { type: 'blob.upload-completed', payload: { blob: {} as never, tokenPayload: null } })).rejects.toThrow();
  });
});

describe('direct download URLs', () => {
  it('are presigned GET URLs on the private store host, one delegation reused', async () => {
    const store = blobStore();
    const u = new URL((await store.directUrl(`projects/${P}/images/img_aaaa-1111.png`, false))!);
    expect(u.hostname).toBe('teststore123.private.blob.vercel-storage.com');
    expect(u.pathname).toBe(`/projects/${P}/images/img_aaaa-1111.png`);
    expect(u.searchParams.get('vercel-blob-signature')).toBeTruthy();
    expect(u.searchParams.get('vercel-blob-delegation')).toBeTruthy();
    // Capped at the delegation's expiry (an hour), so no valid-until of its own is needed then.
    expect(Number(u.searchParams.get('vercel-blob-valid-until') ?? Date.now() + 3600_000)).toBeLessThanOrEqual(Date.now() + 3600_000);
    expect(u.searchParams.has('cache')).toBe(false);
    const fresh = new URL((await store.directUrl(`projects/${P}/thumb.jpg`, true))!);
    expect(fresh.searchParams.get('cache')).toBe('0'); // a replaced thumbnail is read from the store, not a CDN copy
    expect(issued.calls).toBe(1);
  });
});
