/* Vercel Blob client upload, the browser half of lib/projects/server/blob-store.ts: asks
   /api/projects/upload for a token for one pathname, then sends the bytes straight to the Blob store
   (no function in between, so no 4.5 MB limit). Loaded only when the server's store is Vercel Blob.
   One PUT, not multipart: each part of a multipart upload counts as a Blob operation, of which the
   Hobby plan includes 2,000 a month. Browser only. */
import { upload } from '@vercel/blob/client';

export async function uploadToBlob(pathname: string, blob: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  try {
    await upload(pathname, blob, {
      access: 'private',
      handleUploadUrl: '/api/projects/upload',
      contentType: blob.type || undefined,
      multipart: false,
      abortSignal: signal,
      onUploadProgress: onProgress && ((e) => onProgress(e.loaded)),
    });
  } catch (e) {
    // An image id always names the same bytes: one that's already there is done.
    if (/already exists/i.test(e instanceof Error ? e.message : '')) return;
    throw e;
  }
}
