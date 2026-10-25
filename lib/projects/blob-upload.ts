/* Vercel Blob client upload, the browser half of lib/projects/server/blob-store.ts: asks
   /api/projects/upload for a token for one pathname, then sends the bytes straight to the Blob store
   (no function in between, so no 4.5 MB limit). Loaded only when the server's store is Vercel Blob.
   One PUT, not multipart: each part of a multipart upload counts as a Blob operation, of which the
   Hobby plan includes 2,000 a month. Browser only.

   No byte-level progress: with onUploadProgress the SDK streams the body, which Chrome only sends over
   HTTP/2, so behind a proxy that speaks HTTP/1.1 every upload fails (and the SDK retries a network
   error 10 times with backoff, ~17 minutes). A plain body works everywhere; progress is reported when
   the file is done. */
import { upload } from '@vercel/blob/client';

export async function uploadToBlob(pathname: string, blob: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  try {
    await upload(pathname, blob, {
      access: 'private',
      handleUploadUrl: '/api/projects/upload',
      contentType: blob.type || undefined,
      multipart: false,
      abortSignal: signal,
    });
  } catch (e) {
    // An image id always names the same bytes: one that's already there is done.
    if (!/already exists/i.test(e instanceof Error ? e.message : '')) throw e;
  }
  onProgress?.(blob.size);
}
