/* Pure draft canvas building for the Claude connector: new drafts, adding pages, layout presets,
   looks, and text summaries. */
import { describe as describeDraft, DraftError, addPageTo, CANVASES, newDraft, setLayout } from '@/lib/mcp/draft';
import { DEFAULT_CAPTURE, PRESETS, type MediaItem } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { describe, expect, it } from 'vitest';

const page = (n: number): MediaItem => ({
  imageId: `img_0000000${n}`,
  name: `example.com/page-${n}`,
  source: {
    kind: 'url',
    url: `https://example.com/page-${n}`,
    capturedAt: '2026-11-16T00:00:00.000Z',
    options: { ...DEFAULT_CAPTURE, width: 1440, scale: 1, fullPage: true },
  },
  nw: 1440,
  nh: 3200,
});

describe('mcp draft', () => {
  it('creates a valid draft for every canvas size', () => {
    for (const canvas of CANVASES) {
      const doc = newDraft(canvas);
      expect(doc.preset).toBe(canvas);
      expect(doc.W).toBe(PRESETS[canvas].w);
      expect(doc.H).toBe(PRESETS[canvas].h);
      expect(sanitizeComposition(doc)).not.toBeNull();
    }
  });

  it('applies a named look and rejects an unknown look', () => {
    const base = newDraft('pin');
    const styled = newDraft('pin', 'Midnight');
    expect(styled.background).not.toEqual(base.background);
    expect(sanitizeComposition(styled)).not.toBeNull();
    expect(() => newDraft('pin', 'No Such Look')).toThrow(DraftError);
  });

  it('fills layouts 1–3 and puts a fourth page in Media', () => {
    const doc = newDraft('pin');
    expect(doc.count).toBe(2);

    expect(addPageTo(doc, page(1))).toEqual({ where: 'layout', index: 0 });
    expect(doc.count).toBe(2);

    expect(addPageTo(doc, page(2))).toEqual({ where: 'layout', index: 1 });
    expect(doc.count).toBe(2);

    expect(addPageTo(doc, page(3))).toEqual({ where: 'layout', index: 2 });
    expect(doc.count).toBe(3);

    expect(addPageTo(doc, page(4))).toEqual({ where: 'media' });
    expect(doc.count).toBe(3);
    expect(doc.slots.slice(0, 3).map((s) => s.imageId)).toEqual(['img_00000001', 'img_00000002', 'img_00000003']);
    expect(doc.media?.map((m) => m.imageId)).toContain('img_00000004');
    expect(sanitizeComposition(doc)).not.toBeNull();
  });

  it('changes layout preset and rejects presets not offered for the count', () => {
    const doc = newDraft('pin');
    setLayout(doc, { layouts: 3, layout: 'Bento' });
    expect(doc.count).toBe(3);
    expect(doc.arrangement).toBe('grid');
    expect(sanitizeComposition(doc)).not.toBeNull();

    setLayout(doc, { layouts: 1 });
    expect(() => setLayout(doc, { layout: 'Bento' })).toThrow(DraftError);
    try {
      setLayout(doc, { layout: 'Bento' });
    } catch (e) {
      expect((e as Error).message).toContain('Scroll');
      expect((e as Error).message).toContain('Framed');
    }
  });

  it('describes the canvas label and each page name', () => {
    const doc = newDraft('etsy43');
    addPageTo(doc, page(1));
    const text = describeDraft(doc, 'Shop listing');
    expect(text).toContain('Etsy listing');
    expect(text).toContain('example.com/page-1');
  });
});
