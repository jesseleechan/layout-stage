/* Capture jobs in the editor: a capture from the dialog, a desktop + phone pair, a one-click
   re-capture and Re-capture all. Each job shows "Capturing…" on its layout (store.captureJobs) until
   its image lands as its own undo step; captures run one at a time (client.ts queues them).
   Credentials, when given, go with the request only (client.ts) and never into a layout. Browser only. */
import type { CaptureOptions, SlotSource } from '../model';
import { captureJobSlot, useEditor } from '../store';
import type { CaptureAuth } from './auth';
import { addRecentUrl, captureName, captureUrl, TRIMMED_MESSAGE } from './client';
import { CAPTURE_MESSAGES, CaptureError } from './errors';
import { hostOf, pairOptions, pairTarget, recapturable } from './recapture';

export interface CaptureSpec {
  url: string;
  options: CaptureOptions;
  auth?: CaptureAuth | null;
}

const S = () => useEditor.getState();

export const errorMessage = (e: unknown) => (e instanceof CaptureError ? e.message : CAPTURE_MESSAGES.failed);

/** Whether a capture is on its way to layout i. */
export function isCapturing(i: number): boolean {
  const { doc, captureJobs } = S();
  return captureJobs.some((j) => captureJobSlot(doc, j) === i);
}

/** Captures for a started job and lands the image (see store.landCapture), then ends the job,
 *  whatever happens. Resolves to the new image id, or null when the image couldn't be read (the store
 *  has said why). Throws CaptureError. */
export async function runJob(job: number, spec: CaptureSpec, how: { keepFraming?: boolean; avoidId?: string | null } = {}): Promise<string | null> {
  try {
    const { blob, trimmed, finalUrl } = await captureUrl(spec.url, spec.options, undefined, spec.auth);
    const st = S();
    // The target layout follows its image, in case layouts were removed or reordered meanwhile.
    const running = st.captureJobs.find((j) => j.id === job);
    const targetId = running && captureJobSlot(st.doc, running) != null ? running.targetId : null;
    const source: SlotSource = {
      kind: 'url',
      url: spec.url,
      capturedAt: new Date().toISOString(),
      options: spec.options,
      ...(spec.auth ? { needsPassword: true } : {}),
    };
    const id = await st.landCapture({ blob, name: captureName(finalUrl), source }, { targetId, ...how });
    if (id) {
      void addRecentUrl(spec.url);
      if (trimmed) S().showToast(TRIMMED_MESSAGE);
    }
    return id;
  } finally {
    S().endCaptureJob(job);
  }
}

/** Starts the jobs for a capture from the dialog, so their layouts show "Capturing…" at once: one,
 *  or for desktop + phone two (the target and the layout after it). */
export function startJobs(url: string, target: number | null, pair: boolean): number[] {
  const first = S().startCaptureJob(url, target);
  return pair ? [first, S().startCaptureJob(url, pairTarget(S().doc, target))] : [first];
}

export const PHONE_FAILED = 'The desktop capture is in. The phone capture didn’t work:';

/** Runs the jobs from startJobs(). A pair captures Desktop 1440 full page into the first layout and
 *  Phone 390 first screen into the second, never on top of the desktop one. keepFraming applies to
 *  the first. Throws CaptureError; a failed desktop capture cancels the phone one. */
export async function runJobs(jobs: number[], spec: CaptureSpec, keepFraming = false): Promise<void> {
  if (jobs.length < 2) {
    await runJob(jobs[0], spec, { keepFraming });
    return;
  }
  const [desktop, phone] = pairOptions(spec.options);
  let first: string | null;
  try {
    first = await runJob(jobs[0], { ...spec, options: desktop }, { keepFraming });
  } catch (e) {
    S().endCaptureJob(jobs[1]);
    throw e;
  }
  try {
    await runJob(jobs[1], { ...spec, options: phone }, { avoidId: first });
  } catch (e) {
    const err = e instanceof CaptureError ? e : new CaptureError('failed');
    throw new CaptureError(err.code, `${PHONE_FAILED} ${err.message}`);
  }
}

const recaptureFailed = (url: string, e: unknown) => `Couldn’t re-capture ${hostOf(url)}. ${errorMessage(e)}`;

/** Re-captures layout i from its URL with its options, keeping its framing. A page behind a password
 *  opens the dialog instead, which asks for the password again (it is never stored). */
export async function recapture(i: number): Promise<void> {
  const item = recapturable(S().doc).find((r) => r.i === i);
  if (!item || isCapturing(i)) return;
  if (item.needsPassword) {
    S().openRecapture(i);
    return;
  }
  const job = S().startCaptureJob(item.url, i);
  try {
    await runJob(job, { url: item.url, options: item.options }, { keepFraming: true });
  } catch (e) {
    S().showToast(recaptureFailed(item.url, e));
  }
}

const layouts = (n: number) => `${n} layout${n === 1 ? '' : 's'}`;

/** Re-captures every layout that came from a URL, one after another, each keeping its framing.
 *  Pages behind a password are skipped (the toast says how to re-capture them). */
export async function recaptureAll(): Promise<void> {
  const items = recapturable(S().doc).filter((r) => !isCapturing(r.i));
  const locked = items.filter((r) => r.needsPassword);
  const queued = items.filter((r) => !r.needsPassword).map((r) => ({ ...r, job: S().startCaptureJob(r.url, r.i) }));
  let done = 0;
  let failure = '';
  for (const r of queued) {
    try {
      if (await runJob(r.job, { url: r.url, options: r.options }, { keepFraming: true })) done++;
    } catch (e) {
      failure ||= recaptureFailed(r.url, e);
    }
  }
  const skipped = !locked.length
    ? ''
    : locked.length === 1
      ? ` Layout ${locked[0].i + 1} needs a password: use Re-capture in its Replace menu.`
      : ` Layouts ${locked.map((r) => r.i + 1).join(' and ')} need a password: use Re-capture in their Replace menus.`;
  if (failure) S().showToast(`Re-captured ${done} of ${layouts(queued.length)}. ${failure}${skipped}`);
  else if (queued.length) S().showToast(`Re-captured ${layouts(done)}.${skipped}`);
  else if (skipped) S().showToast(skipped.trim());
}
