/* A project's files: /api/projects/<id>/files/images/<imageId>.<ext> and …/files/thumb.jpg.
   GET streams the file from the store: how the local store serves downloads, and the fallback when a
   browser can't fetch a Blob store's direct URL (on Vercel a function's response is capped at 4.5 MB,
   so big images are meant to come from the direct URL).
   PUT (local store only) takes one chunk of an upload: headers X-Upload-Offset and X-Upload-Total, a
   body of at most 4 MB (under Vercel's 4.5 MB limit, like everything else here). On Blob, uploads go
   from the browser straight to the store (/api/projects/upload hands out the tokens). */
import { UPLOAD_CHUNK, uploadRule } from '@/lib/projects/model';
import { OffsetMismatch, type FsStore } from '@/lib/projects/server/fs-store';
import { failure, fromError, json, NO_STORE, sameOrigin, syncOff } from '@/lib/projects/server/http';
import { projectStore } from '@/lib/projects/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; path: string[] }> };

async function target(params: Ctx['params']) {
  const { id, path } = await params;
  const pathname = `projects/${id}/${path.join('/')}`;
  return { pathname, rule: uploadRule(pathname) };
}

export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  try {
    const { pathname, rule } = await target(params);
    if (!rule) return failure(404, 'not_found', 'No such file.');
    const store = await projectStore();
    if (!store) return syncOff();
    const f = await store.read(pathname);
    if (!f) return failure(404, 'not_found', 'No such file.');
    const headers: Record<string, string> = {
      'Content-Type': f.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // An image id always names the same bytes; the thumbnail is replaced as the canvas changes.
      'Cache-Control': rule.overwrite ? 'private, no-cache' : 'private, max-age=31536000, immutable',
    };
    if (f.size != null) headers['Content-Length'] = String(f.size);
    return new Response(f.body, { headers });
  } catch (e) {
    return fromError(e);
  }
}

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  if (!sameOrigin(request)) return failure(400, 'bad_request', 'Expected a request from the editor.');
  try {
    const { pathname, rule } = await target(params);
    if (!rule) return failure(404, 'not_found', 'That file can’t be uploaded here.');
    const store = await projectStore();
    if (!store) return syncOff();
    if (store.kind !== 'local') return failure(405, 'use_client_upload', 'Upload straight to the store.');
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const typeOk = rule.contentTypes.some((t) => (t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t));
    const offset = Number(request.headers.get('x-upload-offset'));
    const total = Number(request.headers.get('x-upload-total'));
    if (!typeOk) return failure(415, 'bad_type', 'That file type can’t be uploaded here.');
    if (!Number.isInteger(offset) || !Number.isInteger(total) || offset < 0 || total <= 0 || offset >= total) return failure(400, 'bad_request', 'Bad upload range.');
    if (total > rule.maxBytes) return failure(413, 'too_big', 'That file is too big to sync.');
    if (Number(request.headers.get('content-length') || 0) > UPLOAD_CHUNK) return failure(413, 'too_big', 'Send uploads in chunks of 4 MB or less.');
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > UPLOAD_CHUNK) return failure(413, 'too_big', 'Send uploads in chunks of 4 MB or less.');
    const r = await (store as FsStore).writeChunk(pathname, offset, total, bytes, rule.overwrite);
    return json({ done: r !== 'partial', exists: r === 'exists' });
  } catch (e) {
    if (e instanceof OffsetMismatch) return Response.json({ code: 'offset', have: e.have }, { status: 409, headers: NO_STORE });
    return fromError(e);
  }
}
