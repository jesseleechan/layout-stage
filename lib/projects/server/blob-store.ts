/* The project store on Vercel: a private Vercel Blob store (BLOB_READ_WRITE_TOKEN, set by Vercel when
   the store is connected to the project). The only module that talks to Vercel Blob on the server;
   lib/projects/blob-upload.ts is its browser half (client uploads).

   Nothing big passes through a function (Vercel caps request and response bodies at 4.5 MB):
   - uploads are client uploads: handleClientUpload() hands the browser a token for one pathname
     (uploadRule: a project's images or its thumbnail, image types, a size limit), and the browser
     sends the bytes straight to Blob;
   - downloads use presigned GET URLs (issueSignedToken once an hour, then presignUrl per file, signed
     here without a network call), which the browser fetches straight from the store. The store's
     host answers with Access-Control-Allow-Origin: *, so fetch() can read them.
   JSON (the list, a project) is small and goes through the API routes, read with useCache: false
   and written with ifMatch, so two devices can't overwrite each other unnoticed. Server only. */
import {
  BlobNotFoundError, BlobPreconditionFailedError, del, get, issueSignedToken, list, presignUrl, put, type IssuedSignedToken,
} from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { uploadRule } from '../model';
import { PreconditionFailed, type FileStream, type ProjectStore, type StoredJson } from './store';

const ACCESS = 'private' as const;

const lostRace = (e: unknown) => e instanceof BlobPreconditionFailedError || /already exists/i.test(e instanceof Error ? e.message : '');

let signed: IssuedSignedToken | null = null;
/** A read-only delegation for the whole store, reused until 20 minutes before it expires. */
async function readToken(): Promise<IssuedSignedToken> {
  if (!signed || signed.validUntil - Date.now() < 20 * 60_000) {
    signed = await issueSignedToken({ operations: ['get'], validUntil: Date.now() + 60 * 60_000 });
  }
  return signed;
}

async function open(path: string, fresh: boolean, headers?: HeadersInit) {
  try {
    const r = await get(path, { access: ACCESS, useCache: !fresh, headers });
    return r && r.statusCode === 200 ? r : null;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

export function blobStore(): ProjectStore {
  return {
    kind: 'blob',

    async readJson<T>(path: string): Promise<StoredJson<T> | null> {
      // Uncompressed: the ETag of a compressed answer isn't one ifMatch accepts (every update to an
      // existing project was refused). A weak one is logged: writes to that file may be refused.
      const r = await open(path, true, { 'accept-encoding': 'identity' });
      if (!r) return null;
      const etag = r.blob.etag.replace(/^W\//, '');
      if (etag !== r.blob.etag || !etag) console.warn('[projects] weak or missing ETag on', path);
      return { data: JSON.parse(await new Response(r.stream).text()) as T, etag };
    },

    async writeJson(path, data, ifMatch) {
      try {
        const r = await put(path, JSON.stringify(data), {
          access: ACCESS,
          contentType: 'application/json',
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          ...(ifMatch ? { ifMatch } : { allowOverwrite: false }),
        });
        return r.etag;
      } catch (e) {
        if (lostRace(e)) throw new PreconditionFailed();
        throw e;
      }
    },

    async list(prefix) {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        out.push(...page.blobs.map((b) => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },

    async remove(paths) {
      for (let i = 0; i < paths.length; i += 500) await del(paths.slice(i, i + 500));
    },

    async directUrl(path, fresh) {
      // Valid for up to an hour (never past the delegation, which has at least 20 minutes left), so a
      // slow download of many images doesn't run out of time.
      const { presignedUrl } = await presignUrl(await readToken(), {
        operation: 'get', pathname: path, access: ACCESS, validUntil: Date.now() + 60 * 60_000, useCache: !fresh,
      });
      return presignedUrl;
    },

    async read(path): Promise<FileStream | null> {
      const r = await open(path, false);
      return r && { body: r.stream, size: r.blob.size, type: r.blob.contentType };
    },
  };
}

/** The client-upload token route: a token for one image or thumbnail pathname of a project, or an
 *  error for anything else. No upload-completed callback (the deployment sits behind Vercel
 *  Authentication, which Blob's callback couldn't pass); the browser reports what it uploaded. */
export async function handleClientUpload(request: Request, body: HandleUploadBody): Promise<{ clientToken: string }> {
  if (body?.type !== 'blob.generate-client-token') throw new Error('Only upload tokens are handed out here.');
  const r = await handleUpload({
    request,
    body,
    onBeforeGenerateToken: async (pathname) => {
      const rule = uploadRule(pathname);
      if (!rule) throw new Error('That file can’t be uploaded here.');
      return {
        allowedContentTypes: rule.contentTypes,
        maximumSizeInBytes: rule.maxBytes,
        allowOverwrite: rule.overwrite,
        addRandomSuffix: false,
        validUntil: Date.now() + 15 * 60_000,
        ...(rule.overwrite ? { cacheControlMaxAge: 60 } : {}),
      };
    },
  });
  if (r.type !== 'blob.generate-client-token') throw new Error('Unexpected upload event.');
  return { clientToken: r.clientToken };
}
