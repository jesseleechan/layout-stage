/* POST /api/projects/upload: Vercel Blob client uploads (handleUpload). The browser asks for a token
   for one pathname (a project's image or thumbnail; see uploadRule) and then sends the bytes straight
   to the Blob store, so no upload passes through a function and Vercel's 4.5 MB body limit never
   applies. Only when the store is Vercel Blob; the local store takes chunked PUTs on the files route. */
import { failure, fromError, isJson, json, readJsonBody, sameOrigin, syncOff } from '@/lib/projects/server/http';
import { projectStore } from '@/lib/projects/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request) || !isJson(request)) return failure(400, 'bad_request', 'Expected JSON from the editor.');
  try {
    const store = await projectStore();
    if (!store) return syncOff();
    if (store.kind !== 'blob') return failure(404, 'not_found', 'Uploads go to the files route here.');
    const body = await readJsonBody(request, 16 * 1024);
    const { handleClientUpload } = await import('@/lib/projects/server/blob-store');
    try {
      return json(await handleClientUpload(request, body as Parameters<typeof handleClientUpload>[1]));
    } catch (e) {
      return failure(400, 'not_allowed', e instanceof Error ? e.message : 'That upload isn’t allowed.');
    }
  } catch (e) {
    return fromError(e);
  }
}
