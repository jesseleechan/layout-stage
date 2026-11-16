/* Constant-time token check for the Claude connector (/api/mcp). Server only. */
import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LEN = 24;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Whether a request may use the MCP endpoint: MCP_TOKEN must be set (else the endpoint is off) and
 *  the request must carry it, as `Authorization: Bearer …` or as `?key=…` (connector URLs can't set
 *  headers). Compared in constant time. */
export function mcpAccess(request: Request, env: Record<string, string | undefined> = process.env): 'ok' | 'off' | 'denied' {
  const expected = env.MCP_TOKEN ?? '';
  if (expected.length < MIN_TOKEN_LEN) return 'off';

  const auth = request.headers.get('authorization');
  const bearer = /^bearer[ \t]+(\S+)[ \t]*$/i.exec(auth ?? '')?.[1] ?? null;
  let key: string | null = null;
  try {
    key = new URL(request.url).searchParams.get('key');
  } catch {
    key = null;
  }
  const given = bearer ?? key;
  if (!given) return 'denied';
  return timingSafeEqual(sha256(given), sha256(expected)) ? 'ok' : 'denied';
}
