/* The browser half of Blob uploads: always a plain body (no SDK progress, which would stream the body
   and need HTTP/2), progress reported when the file is done, "already exists" counts as done. The SDK
   is mocked. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ calls: [] as { progress: boolean; multipart: unknown; access: unknown }[], fail: null as Error | null }));
vi.mock('@vercel/blob/client', () => ({
  upload: vi.fn(async (path: string, _blob: Blob, opts: { onUploadProgress?: unknown; multipart?: unknown; access?: unknown }) => {
    sdk.calls.push({ progress: !!opts.onUploadProgress, multipart: opts.multipart, access: opts.access });
    if (sdk.fail) throw sdk.fail;
    return { pathname: path };
  }),
}));

import { uploadToBlob } from '@/lib/projects/blob-upload';

const file = () => new Blob([new Uint8Array(1234)], { type: 'image/png' });

beforeEach(() => {
  sdk.calls = [];
  sdk.fail = null;
});

describe('uploadToBlob', () => {
  it('sends one private, single-part PUT without SDK progress, then reports the file done', async () => {
    const seen: number[] = [];
    await uploadToBlob('projects/p/images/a.png', file(), (n) => seen.push(n));
    expect(sdk.calls).toEqual([{ progress: false, multipart: false, access: 'private' }]);
    expect(seen).toEqual([1234]);
  });

  it('treats "already exists" as done', async () => {
    sdk.fail = new Error('Vercel Blob: This blob already exists');
    const seen: number[] = [];
    await uploadToBlob('projects/p/images/a.png', file(), (n) => seen.push(n));
    expect(seen).toEqual([1234]);
  });

  it('passes other errors on, without reporting progress', async () => {
    sdk.fail = new TypeError('Failed to fetch');
    const seen: number[] = [];
    await expect(uploadToBlob('projects/p/images/a.png', file(), (n) => seen.push(n))).rejects.toThrow('Failed to fetch');
    expect(seen).toEqual([]);
  });
});
