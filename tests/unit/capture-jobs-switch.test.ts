/* Capture jobs across project switches: showProject drops running jobs, and runJob discards an
   in-flight capture's image instead of landing it in the newly opened project. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { runJob } from '@/lib/capture/jobs';
import { clone, DEFAULT_CAPTURE, defaultUi } from '@/lib/model';
import { useEditor } from '@/lib/store';
import { classicComposition } from './helpers';

const images = vi.hoisted(() => ({ seq: 0, next: [1440, 4000] as [number, number], sizes: new Map<string, [number, number]>() }));
vi.mock('@/lib/images', () => ({
  putImage: vi.fn(async () => {
    const id = `img:${++images.seq}`;
    images.sizes.set(id, images.next);
    return id;
  }),
  loadImage: vi.fn(async (id: string) => {
    const s = images.sizes.get(id);
    return s ? ({ naturalWidth: s[0], naturalHeight: s[1] } as HTMLImageElement) : null;
  }),
  ingestImage: vi.fn(async () => {
    const id = `img:${++images.seq}`;
    images.sizes.set(id, images.next);
    return { id, nw: images.next[0], nh: images.next[1] };
  }),
  pruneImages: vi.fn(async () => undefined),
  releaseImage: vi.fn(),
}));

const cap = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void) }));
vi.mock('@/lib/capture/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/client')>()),
  captureUrl: vi.fn(() => new Promise((res) => { cap.resolve = res; })),
  addRecentUrl: vi.fn(async () => undefined),
}));

const S = () => useEditor.getState();

beforeEach(() => {
  cap.resolve = null;
  useEditor.setState({ captureJobs: [], ui: { ...defaultUi(), selected: 0 }, toast: null });
  S().loadComposition(classicComposition());
});

describe('capture jobs on project switch', () => {
  it('drops a capture started before a switch', async () => {
    const job = S().startCaptureJob('https://example.com', 0);
    const p = runJob(job, { url: 'https://example.com', options: DEFAULT_CAPTURE });
    await vi.waitFor(() => expect(cap.resolve).not.toBeNull());

    S().showProject(defaultComposition());
    const snap = clone(S().doc);

    cap.resolve!({ blob: new Blob(['x'], { type: 'image/png' }), trimmed: false, finalUrl: 'https://example.com/' });
    expect(await p).toBeNull();
    expect(S().doc).toEqual(snap);
    expect(S().captureJobs).toEqual([]);
    expect(S().canUndo).toBe(false);
  });

  it('lands the capture when no switch happened', async () => {
    const job = S().startCaptureJob('https://example.com', 0);
    const p = runJob(job, { url: 'https://example.com', options: DEFAULT_CAPTURE });
    await vi.waitFor(() => expect(cap.resolve).not.toBeNull());

    cap.resolve!({ blob: new Blob(['x'], { type: 'image/png' }), trimmed: false, finalUrl: 'https://example.com/' });
    const id = await p;
    expect(typeof id).toBe('string');
    expect(S().doc.slots[0].imageId).toBe(id);
  });

  it('showProject ends running jobs', () => {
    S().startCaptureJob('https://example.com/1', 0);
    S().startCaptureJob('https://example.com/2', 1);
    expect(S().captureJobs).toHaveLength(2);

    S().showProject(defaultComposition());
    expect(S().captureJobs).toEqual([]);
  });
});
