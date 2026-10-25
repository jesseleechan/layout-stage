/* Pure helpers for reading what the capture browser saw: bot walls and navigation errors. */
import { CaptureError, httpErrorMessage, NOT_FOUND_MESSAGE, REDIRECT_LOOP_MESSAGE } from './errors';

/** Markers that only appear on challenge / block pages (Cloudflare, DataDome, PerimeterX, Akamai,
 *  Imperva, Sucuri, generic "are you human" pages), whatever the status code. */
const STRONG_TITLE = [
  /^just a moment/i, // Cloudflare
  /attention required!? \| cloudflare/i,
  /^access to this page has been denied/i, // PerimeterX / HUMAN
  /^pardon our interruption/i, // Imperva / Distil
  /^(please )?verify(ing)? (that )?you are (a )?human/i,
  /^are you a robot/i,
  /^(security|bot) (check|verification)/i,
  /^checking (if the site connection is secure|your browser)/i,
  /^human verification/i,
];
const STRONG_HTML = [
  '_cf_chl_opt', // Cloudflare challenge
  'cf-chl-widget',
  'captcha-delivery.com', // DataDome block page
  'id="px-captcha"', // PerimeterX
  'sec-if-cpt-container', // Akamai bot manager
  'incapsula incident id', // Imperva
  'errors.edgesuite.net', // Akamai "Access Denied … Reference #"
  'sucuri website firewall - access denied',
];
/** Only meaningful together with a 403 / 429 / 503 (plenty of normal pages carry a reCAPTCHA form). */
const WEAK_HTML = /captcha|cf-error-details|cf-challenge|datadome|perimeterx|incapsula|imperva|sucuri|access denied|are you (a )?(human|robot)|bot (protection|detection)|automated (access|requests|traffic)/i;

export function looksBlocked(status: number, title: string, html: string): boolean {
  const t = title.trim();
  const h = html.slice(0, 400_000).toLowerCase();
  if (STRONG_TITLE.some((r) => r.test(t)) || STRONG_HTML.some((m) => h.includes(m))) return true;
  if (status === 429) return true;
  if (status === 403 || status === 503) return WEAK_HTML.test(t) || WEAK_HTML.test(h);
  return false;
}

/** Maps the page's final status (and content) to an error, or null when it's fine to capture. */
export function pageError(status: number, title: string, html: string): CaptureError | null {
  if (looksBlocked(status, title, html)) return new CaptureError('blocked');
  if (status >= 400) return new CaptureError('http_error', httpErrorMessage(status));
  return null;
}

/** Maps a Playwright navigation error (net::ERR_* or a timeout) to a CaptureError. */
export function navError(e: unknown): CaptureError {
  if (e instanceof CaptureError) return e;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/TimeoutError|Timeout \d+ms exceeded/i.test(msg)) return new CaptureError('timeout');
  const net = /net::(ERR_[A-Z_]+)/.exec(msg)?.[1] ?? '';
  if (/^ERR_NAME_(NOT_RESOLVED|RESOLUTION_FAILED)$/.test(net)) return new CaptureError('unreachable', NOT_FOUND_MESSAGE);
  if (/^ERR_(CERT_|SSL_(?!PROTOCOL)|BAD_SSL)/.test(net)) return new CaptureError('insecure');
  if (net === 'ERR_TOO_MANY_REDIRECTS') return new CaptureError('http_error', REDIRECT_LOOP_MESSAGE);
  if (net === 'ERR_TIMED_OUT') return new CaptureError('timeout');
  if (net === 'ERR_UNSAFE_PORT') return new CaptureError('invalid_url');
  if (
    /^ERR_(CONNECTION_|ADDRESS_|INTERNET_DISCONNECTED|TUNNEL_CONNECTION_FAILED|PROXY_|EMPTY_RESPONSE|SSL_PROTOCOL_ERROR|NETWORK_|SOCKS_|HTTP2_|QUIC_)/.test(net)
  )
    return new CaptureError('unreachable');
  if (/Executable doesn't exist|playwright install/i.test(msg)) return new CaptureError('no_browser');
  return new CaptureError('failed');
}
