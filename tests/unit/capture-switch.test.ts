/* Switching URL capture off (NEXT_PUBLIC_CAPTURE=off, lib/capture/switch.ts): both capture routes
   refuse before starting a browser, and the editor's capture dialog doesn't open. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as capture } from '@/app/api/capture/route';
import { POST as pages } from '@/app/api/pages/route';
import { captureOn } from '@/lib/capture/switch';
import { useEditor } from '@/lib/store';

afterEach(() => {
  vi.unstubAllEnvs();
  useEditor.getState().closeCapture();
});

const post = (path: string) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/' }) });

describe('the capture switch', () => {
  it('is on unless the deployment says off', () => {
    expect(captureOn()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_CAPTURE', 'on');
    expect(captureOn()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_CAPTURE', 'off');
    expect(captureOn()).toBe(false);
  });

  it('off: both routes refuse with a message to upload instead', async () => {
    vi.stubEnv('NEXT_PUBLIC_CAPTURE', 'off');
    for (const [route, path] of [[capture, '/api/capture'], [pages, '/api/pages']] as const) {
      const r = await route(post(path));
      expect(r.status, path).toBe(403);
      expect(await r.json(), path).toEqual({ code: 'off', message: 'Capturing from a URL is switched off on this site. Upload a screenshot instead.' });
    }
  });

  it('off: neither capture dialog opens; on, they do', () => {
    vi.stubEnv('NEXT_PUBLIC_CAPTURE', 'off');
    useEditor.getState().openCapture(null);
    useEditor.getState().openRecapture(0);
    expect(useEditor.getState().captureDialog.open).toBe(false);
    vi.unstubAllEnvs();
    useEditor.getState().openCapture(null);
    expect(useEditor.getState().captureDialog.open).toBe(true);
  });
});
