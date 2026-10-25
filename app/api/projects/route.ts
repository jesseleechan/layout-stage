/* GET /api/projects → { sync: 'blob' | 'local' | 'off', projects: [{ id, name, createdAt, updatedAt,
   rev, thumbRev, thumbUrl }] }. One read of projects/index.json; thumbUrl is a short-lived direct URL
   (Blob) or the files route (local store). Never cached. */
import { thumbPath } from '@/lib/projects/model';
import { listProjects } from '@/lib/projects/server/api';
import { fromError, json } from '@/lib/projects/server/http';
import { projectStore } from '@/lib/projects/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const store = await projectStore();
    if (!store) return json({ sync: 'off', projects: [] });
    const projects = await listProjects(store);
    const out = await Promise.all(
      projects.map(async (p) => ({
        ...p,
        thumbUrl: p.thumbRev ? ((await store.directUrl(thumbPath(p.id), true)) ?? `/api/projects/${p.id}/files/thumb.jpg?v=${p.thumbRev}`) : null,
      })),
    );
    return json({ sync: store.kind, projects: out });
  } catch (e) {
    return fromError(e);
  }
}
