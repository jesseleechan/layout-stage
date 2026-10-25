/* Staging sites behind HTTP basic auth. The username and password travel with one capture request
   only: they are never stored (not in a layout's options, recent URLs, autosave or logs), and the
   capture browser sends them only to the page's own origin. Pure; shared by the dialog, the route and
   the capture server. */
import { CaptureError } from './errors';

export interface CaptureAuth {
  username: string;
  password: string;
}

export const MAX_AUTH_LENGTH = 256;
export const CREDENTIALS_IN_URL_MESSAGE = 'Put the username and password under Password-protected site, not in the address.';

/** Basic auth can't carry a colon in the user name, and neither field may hold control characters. */
export function authProblem(auth: CaptureAuth): string | null {
  if (auth.username.length > MAX_AUTH_LENGTH || auth.password.length > MAX_AUTH_LENGTH) return 'That username or password is too long.';
  if (/[\u0000-\u001f\u007f]/.test(auth.username + auth.password)) return 'That username or password has characters that can’t be sent.';
  if (auth.username.includes(':')) return 'A username can’t contain a colon.';
  return null;
}

/** The credentials in a request body: null when absent or both empty. Throws CaptureError. */
export function parseAuth(raw: unknown): CaptureAuth | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new CaptureError('bad_request');
  const { username, password } = raw as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') throw new CaptureError('bad_request');
  if (!username && !password) return null;
  const auth = { username, password };
  const problem = authProblem(auth);
  if (problem) throw new CaptureError('bad_auth', problem);
  return auth;
}

/** Whether a URL carries a user name or password (https://user:pass@host/). */
export function hasUrlCredentials(url: string): boolean {
  try {
    const u = new URL(url);
    return !!(u.username || u.password);
  } catch {
    return false;
  }
}

/** Moves credentials typed into the address (https://user:pass@host/) out of it, so the address can
 *  be stored and shown without them. */
export function splitUrlCredentials(url: string): { url: string; auth: CaptureAuth | null } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, auth: null };
  }
  if (!u.username && !u.password) return { url, auth: null };
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const auth = { username: dec(u.username), password: dec(u.password) };
  u.username = '';
  u.password = '';
  return { url: u.href, auth };
}

/** The Authorization header value for these credentials (UTF-8, as browsers send it). */
export function basicHeader(auth: CaptureAuth): string {
  let bin = '';
  new TextEncoder().encode(`${auth.username}:${auth.password}`).forEach((b) => (bin += String.fromCharCode(b)));
  return `Basic ${btoa(bin)}`;
}

/** Replaces the credentials (and their Basic header form) wherever they appear in text meant for a log. */
export function redactAuth(text: string, auth: CaptureAuth | null | undefined): string {
  if (!auth) return text;
  const secrets = [basicHeader(auth).slice(6), auth.password, auth.username].filter(Boolean).sort((a, b) => b.length - a.length);
  return secrets.reduce((t, s) => t.split(s).join('***'), text);
}
