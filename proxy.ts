/* Optional password gate for a hosted copy. A Vercel Hobby production domain is public, and
   /api/capture would otherwise be an open screenshot service. When ACCESS_PASSWORD is set, every
   request (pages, assets, /api/capture) needs HTTP Basic auth with that password and any user name;
   the browser asks once and then sends it with every request to the site. Unset (local dev): no gate.
   Next 16's request interceptor (formerly middleware); runs on Node. */
import { createHash, timingSafeEqual } from 'node:crypto';

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

export function proxy(request: Request): Response | undefined {
  const password = process.env.ACCESS_PASSWORD;
  if (!password || basicAuthOk(request.headers.get('authorization'), password)) return undefined;
  return new Response('Password required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${ACCESS_REALM}"`,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
