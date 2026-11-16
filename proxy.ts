/* Password gate for a hosted copy. Local dev and Vercel previews stay open when ACCESS_PASSWORD
   is unset; a Vercel production deployment requires ACCESS_PASSWORD (or an explicit ACCESS_OPEN=1),
   because without it both /api/capture and /api/projects (synced projects and their images) are open
   to anyone with the URL. When ACCESS_PASSWORD is set, every request needs HTTP Basic auth with that
   password and any user name. Next 16's request interceptor (formerly middleware); runs on Node. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { mcpAccess } from './lib/mcp/auth';

export const ACCESS_REALM = 'Layout Stage';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** True when `header` (an Authorization header) carries Basic credentials whose password is
 *  `password`, whatever the user name. Compares digests in constant time, so neither the content
 *  nor the length of the password leaks through timing. */
export function basicAuthOk(header: string | null | undefined, password: string): boolean {
  const m = /^basic[ \t]+([a-z0-9+/_-]+={0,2})[ \t]*$/i.exec(header ?? '');
  if (!m || !password) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':'); // user names can't contain ':', passwords can
  if (colon < 0) return false;
  return timingSafeEqual(sha256(decoded.slice(colon + 1)), sha256(password));
}

/** A production deployment on Vercel with no password and no explicit ACCESS_OPEN=1: it must not
 *  serve, because without the gate the projects store and capture are open to anyone who has the URL. */
export function gateMissing(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !env.ACCESS_PASSWORD && env.ACCESS_OPEN !== '1';
}

const NO_GATE =
  'This deployment has no access password. Set ACCESS_PASSWORD in the Vercel project’s environment variables and redeploy (or ACCESS_OPEN=1 to run it without one).';

export function proxy(request: Request): Response | undefined {
  if (new URL(request.url).pathname === '/api/mcp' && mcpAccess(request) === 'ok') return undefined;
  const password = process.env.ACCESS_PASSWORD;
  if (!password) {
    if (!gateMissing()) return undefined;
    return new Response(NO_GATE, { status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (basicAuthOk(request.headers.get('authorization'), password)) return undefined;
  return new Response('Password required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${ACCESS_REALM}"`,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
