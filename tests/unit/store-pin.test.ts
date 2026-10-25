/* Store actions for pin text: typing is live (no step until commit), Reset to suggestion is one step,
   and text is cut at Pinterest's limits. The image store is mocked (no IndexedDB here). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/images', () => ({
  putImage: async () => 'img_1',
  ingestImage: async () => ({ id: 'img_1', nw: 100, nh: 100 }),
  loadImage: async () => null,
  releaseImage: () => {},
  pruneImages: async () => {},
  useImageUrl: () => null,
  useLoadedImage: () => null,
}));

import { defaultComposition } from '@/lib/arrange';
import { defaultUi } from '@/lib/model';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();

beforeEach(() => {
  S().loadComposition(defaultComposition());
  useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
});

describe('pin text actions', () => {
  it('typing is live; the commit after a pause is one step', () => {
    S().editPinText('title', 'M');
    S().editPinText('title', 'My');
    S().editPinText('title', 'My pin');
    expect(S().doc.pin).toEqual({ title: 'My pin' });
    expect(S().canUndo).toBe(false);
    S().commit();
    expect(S().canUndo).toBe(true);
    S().undo();
    expect(S().doc.pin).toBeUndefined();
    S().redo();
    expect(S().doc.pin).toEqual({ title: 'My pin' });
  });

  it('cuts text at the field’s limit', () => {
    S().editPinText('alt', 'a'.repeat(600));
    expect(S().doc.pin!.alt).toHaveLength(500);
  });

  it('reset to suggestion is one step and drops the empty block', () => {
    S().editPinText('description', 'Mine');
    S().commit();
    S().resetPinText('description');
    expect(S().doc.pin).toBeUndefined();
    S().undo();
    expect(S().doc.pin).toEqual({ description: 'Mine' });
    S().redo();
    expect(S().doc.pin).toBeUndefined();
  });

  it('resetting a field that follows its suggestion does nothing', () => {
    S().resetPinText('title');
    expect(S().canUndo).toBe(false);
  });
});
