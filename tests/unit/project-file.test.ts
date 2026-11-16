/* Project file packing and unpacking: round-trips, missing images, sample-only canvases,
   untrusted input rejection, and file naming. */
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { packProject, projectFileName, unpackProject } from '@/lib/projects/file';
import { projectImageIds } from '@/lib/projects/model';
import { readStoredZip, zipBlobs } from '@/lib/zip';

function docWithImages() {
  const doc = defaultComposition();
  doc.slots[0].imageId = 'img_aaaa1111';
  doc.slots[0].source = { kind: 'file' };
  doc.slots[1].imageId = 'img_bbbb2222';
  doc.slots[1].source = { kind: 'file' };
  return doc;
}

describe('project file', () => {
  it('round-trips a project with its referenced images', async () => {
    const doc = docWithImages();
    const bytesA = new Uint8Array([1, 2, 3, 4]);
    const bytesB = new Uint8Array([5, 6, 7, 8, 9]);
    const blobs = new Map([
      ['img_aaaa1111', new Blob([bytesA], { type: 'image/png' })],
      ['img_bbbb2222', new Blob([bytesB], { type: 'image/png' })],
    ]);

    const packed = await packProject('My pin', doc, async (id) => blobs.get(id) ?? null);
    expect(packed.missing).toBe(0);

    const opened = await unpackProject(packed.file);
    expect(opened).not.toBeNull();
    expect(opened!.name).toBe('My pin');
    expect(opened!.missing).toBe(0);
    expect(projectImageIds(opened!.doc)).toEqual(['img_aaaa1111', 'img_bbbb2222']);
    expect(opened!.images.map((i) => i.id)).toEqual(['img_aaaa1111', 'img_bbbb2222']);
    expect(opened!.images[0].blob.type).toBe('image/png');
    expect(opened!.images[1].blob.type).toBe('image/png');
    expect(new Uint8Array(await opened!.images[0].blob.arrayBuffer())).toEqual(bytesA);
    expect(new Uint8Array(await opened!.images[1].blob.arrayBuffer())).toEqual(bytesB);
  });

  it('reports missing images on pack and unpack', async () => {
    const doc = docWithImages();
    const onlyA = new Map([['img_aaaa1111', new Blob([new Uint8Array([1, 2])], { type: 'image/png' })]]);

    const packed = await packProject('Partial', doc, async (id) => onlyA.get(id) ?? null);
    expect(packed.missing).toBe(1);

    const opened = await unpackProject(packed.file);
    expect(opened).not.toBeNull();
    expect(opened!.missing).toBe(1);
    expect(opened!.images.map((i) => i.id)).toEqual(['img_aaaa1111']);
  });

  it('does not pack sample images', async () => {
    const doc = defaultComposition();
    const packed = await packProject('Samples only', doc, async () => {
      throw new Error('should not fetch sample images');
    });
    expect(packed.missing).toBe(0);
    const entries = await readStoredZip(packed.file);
    expect(entries.map((e) => e.name)).toEqual(['project.json']);

    const opened = await unpackProject(packed.file);
    expect(opened).not.toBeNull();
    expect(opened!.images).toEqual([]);
    expect(opened!.missing).toBe(0);
  });

  it('returns null for non-project inputs', async () => {
    expect(await unpackProject(new Blob(['hello']))).toBeNull();

    const noManifest = await zipBlobs([{ name: 'notes.txt', blob: new Blob(['hi']) }]);
    expect(await unpackProject(noManifest)).toBeNull();

    const wrongApp = await zipBlobs([
      { name: 'project.json', blob: new Blob([JSON.stringify({ app: 'other', v: 1, name: 'X', doc: defaultComposition() })]) },
    ]);
    expect(await unpackProject(wrongApp)).toBeNull();

    const badDoc = await zipBlobs([
      { name: 'project.json', blob: new Blob([JSON.stringify({ app: 'layout-stage', v: 1, name: 'X', doc: {} })]) },
    ]);
    expect(await unpackProject(badDoc)).toBeNull();
  });

  it('ignores extra and unreferenced files', async () => {
    const doc = docWithImages();
    const manifest = JSON.stringify({ app: 'layout-stage', v: 1, name: 'Extra', doc });
    const file = await zipBlobs([
      { name: 'project.json', blob: new Blob([manifest], { type: 'application/json' }) },
      { name: 'images/img_aaaa1111.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
      { name: 'images/img_zzzz9999.png', blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }) },
      { name: 'notes.txt', blob: new Blob(['ignore me']) },
      { name: 'images/evil.exe', blob: new Blob(['nope']) },
    ]);

    const opened = await unpackProject(file);
    expect(opened).not.toBeNull();
    expect(opened!.images.map((i) => i.id)).toEqual(['img_aaaa1111']);
    expect(opened!.missing).toBe(1);
  });

  it('formats projectFileName cleanly', () => {
    expect(projectFileName('My shop — pin 2')).toBe('my-shop-pin-2.layoutstage.zip');
    expect(projectFileName('***')).toBe('project.layoutstage.zip');
  });
});
