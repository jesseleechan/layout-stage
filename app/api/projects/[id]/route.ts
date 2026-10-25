/* One project.
   GET    → { project: { id, name, createdAt, updatedAt, rev, thumbRev, images, doc },
             files: { [image file]: { url, fallback } } }: where each image downloads from (a
             short-lived direct URL on Blob, else the files route; `fallback` is always the route).
   PUT    { baseRev, name, createdAt, updatedAt, thumbRev, images, doc } → { project } (its new rev),
             or 409 { remote } when the store's copy changed since baseRev (remote: null if deleted).
   DELETE → { ok: true }: the project and all its files.
   JSON only (a canvas is a few KB); images never pass through here. */
import { imagePath } from '@/lib/projects/model';
import { deleteProject, MAX_PROJECT_BYTES, parseWrite, readProject, writeProject } from '@/lib/projects/server/api';
import { failure, fromError, isJson, json, readJsonBody, sameOrigin, syncOff } from '@/lib/projects/server/http';
import { projectStore } from '@/lib/projects/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const store = await projectStore();
    if (!store) return syncOff();
    const project = await readProject(store, id);
    if (!project) return failure(404, 'not_found', 'That project isn’t in the store.');
    const files: Record<string, { url: string; fallback: string }> = {};
    await Promise.all(
      project.images.map(async ({ name }) => {
        const fallback = `/api/projects/${id}/files/images/${name}`;
        files[name] = { url: (await store.directUrl(imagePath(id, name), false)) ?? fallback, fallback };
      }),
    );
    return json({ project, files });
  } catch (e) {
    return fromError(e);
  }
}

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  if (!sameOrigin(request) || !isJson(request)) return failure(400, 'bad_request', 'Expected JSON from the editor.');
  try {
    const { id } = await params;
    const store = await projectStore();
    if (!store) return syncOff();
    const r = await writeProject(store, id, parseWrite(await readJsonBody(request, MAX_PROJECT_BYTES + 64 * 1024)));
    return r.ok ? json({ project: r.project }) : json({ code: 'conflict', remote: r.remote }, 409);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  if (!sameOrigin(request)) return failure(400, 'bad_request', 'Expected a request from the editor.');
  try {
    const { id } = await params;
    const store = await projectStore();
    if (!store) return syncOff();
    await deleteProject(store, id);
    return json({ ok: true });
  } catch (e) {
    return fromError(e);
  }
}
