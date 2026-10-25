/* Capture error codes and messages, shared by the server route and the browser. Each message says
   what happened and what to do. */

export type CaptureErrorCode =
  | 'bad_request' // body isn't the JSON the route expects
  | 'invalid_url' // not a web address, or not http/https
  | 'private' // resolves to (or redirects to) a private, loopback, link-local or metadata address
  | 'unreachable' // DNS failure, connection refused, ...
  | 'insecure' // TLS certificate problem
  | 'http_error' // the page answered with an error status
  | 'blocked' // bot wall / challenge page
  | 'timeout' // no load event within 30 s
  | 'no_browser' // Playwright's Chromium isn't installed
  | 'auth_required' // the page answered 401 and no username / password was given
  | 'auth_failed' // the page answered 401 to the username and password
  | 'bad_auth' // a username / password that can't be sent
  | 'bad_selectors' // "Hide elements" isn't a list of CSS selectors
  | 'failed' // anything else on the server
  | 'network' // browser side: the capture route couldn't be reached
  | 'aborted'; // browser side: the caller cancelled

export const CAPTURE_MESSAGES: Record<CaptureErrorCode, string> = {
  bad_request: 'That capture request didn’t make sense. Reload the page and try again.',
  invalid_url: 'That doesn’t look like a web address. Check it and try again.',
  private: 'Only public web addresses can be captured.',
  unreachable: 'Couldn’t reach that site. Check the address and your connection, then try again.',
  insecure: 'That site’s security certificate isn’t valid, so it wasn’t captured. Check the address and try again.',
  http_error: 'That page returned an error. Check the address and try again.',
  blocked: 'This site blocks automated browsers. Take a screenshot and drop it in instead.',
  timeout: 'That page didn’t finish loading in 30 seconds. Try First screen or a longer delay.',
  no_browser: 'The capture browser isn’t installed. Run npx playwright install chromium.',
  auth_required: 'This page needs a username and password. Add them under Password-protected site.',
  auth_failed: 'That username or password didn’t work.',
  bad_auth: 'That username or password can’t be used. Check it and try again.',
  bad_selectors: 'Hide elements takes CSS selectors separated by commas or new lines, like #chat-widget, .promo-bar.',
  failed: 'That page couldn’t be captured. Try again, or take a screenshot and drop it in instead.',
  network: 'Couldn’t reach the capture server. Check that Layout Stage is still running, then try again.',
  aborted: 'Capture cancelled.',
};

export const NOT_FOUND_MESSAGE = 'Couldn’t find that site. Check the address and try again.';
export const SCHEME_MESSAGE = 'Only web addresses that start with http:// or https:// can be captured.';
export const REDIRECT_LOOP_MESSAGE = 'That page keeps redirecting. Check the address and try again.';
export const httpErrorMessage = (status: number) => `That page returned an error (${status}). Check the address and try again.`;

const HTTP_STATUS: Record<CaptureErrorCode, number> = {
  bad_request: 400,
  invalid_url: 400,
  private: 403,
  unreachable: 502,
  insecure: 502,
  http_error: 502,
  blocked: 502,
  timeout: 504,
  no_browser: 503,
  auth_required: 502, // not 401: that would tangle with the editor's own password gate (proxy.ts)
  auth_failed: 502,
  bad_auth: 400,
  bad_selectors: 400,
  failed: 500,
  network: 502,
  aborted: 499,
};

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  constructor(code: CaptureErrorCode, message?: string) {
    super(message || CAPTURE_MESSAGES[code]);
    this.name = 'CaptureError';
    this.code = code;
  }
  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export const isCaptureErrorCode = (v: unknown): v is CaptureErrorCode => typeof v === 'string' && v in CAPTURE_MESSAGES;

export function toCaptureError(e: unknown): CaptureError {
  return e instanceof CaptureError ? e : new CaptureError('failed');
}
