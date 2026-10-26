/* Projects: the pure rules (lib/projects/model.ts): what a sync does, names, upload rules, status. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import {
  copyName, deviceCopyName, editedAgo, fileType, imageFileName, imageIdOf, mergeImages, planSync, projectImageIds, referencedImageIds,
  revisionOf, sanitizeRemote, syncStatus, thumbDue, THUMB_UPLOAD_GAP, untitledName, uploadRule, type LocalProject, type RemoteProject,
} from '@/lib/projects/model';

const P = 'prj_00000000-aaaa';
const Q = 'prj_11111111-bbbb';
const R = 'prj_22222222-cccc';

const local = (id: string, patch: Partial<LocalProject> = {}): LocalProject => ({
  id, name: id, createdAt: 1, updatedAt: 2, rev: 'r1', dirty: false, ...patch,
});
const remote = (id: string, patch: Partial<RemoteProject> = {}): RemoteProject => ({
  id, name: id, createdAt: 1, updatedAt: 2, rev: 'r1', thumbRev: null, ...patch,
});

describe('planSync', () => {
  it('does nothing when both sides match', () => {
    expect(planSync([local(P)], [remote(P)])).toEqual([]);
  });

  it('pushes local changes when the store is unchanged since the last sync', () => {
    expect(planSync([local(P, { dirty: true })], [remote(P)])).toEqual([{ kind: 'push', id: P }]);
  });

  it('pushes a project that was never synced, but not a blank one', () => {
    expect(planSync([local(P, { rev: null, dirty: true }), local(Q, { rev: null, dirty: true, blank: true })], [])).toEqual([{ kind: 'push', id: P }]);
  });

  it('pulls when the store changed and this copy did not', () => {
    const r = remote(P, { rev: 'r2', updatedAt: 9 });
    expect(planSync([local(P)], [r])).toEqual([{ kind: 'pull', id: P, remote: r }]);
  });

  it('keeps both when the store and this copy both changed', () => {
    const r = remote(P, { rev: 'r2' });
    expect(planSync([local(P, { dirty: true })], [r])).toEqual([{ kind: 'fork', id: P, remote: r }]);
  });

  it('lists projects from other devices', () => {
    const r = remote(Q);
    expect(planSync([local(P)], [remote(P), r])).toEqual([{ kind: 'adopt', remote: r }]);
  });

  it('a project deleted elsewhere: dropped when unchanged here, uploaded again when changed here', () => {
    expect(planSync([local(P), local(Q, { dirty: true }), local(R, { stub: true })], [])).toEqual([
      { kind: 'drop', id: P },
      { kind: 'recreate', id: Q },
      { kind: 'drop', id: R },
    ]);
  });

  it('deletes made here go to the store first and are not listed again', () => {
    expect(planSync([local(P)], [remote(P), remote(Q)], [Q])).toEqual([{ kind: 'delete', id: Q }]);
    expect(planSync([local(P)], [remote(P)], [Q])).toEqual([]);
  });

  it('refreshes a listed project that changed elsewhere, without downloading it', () => {
    const r = remote(P, { rev: 'r2', name: 'Renamed' });
    expect(planSync([local(P, { stub: true })], [r])).toEqual([{ kind: 'refresh', id: P, remote: r }]);
  });

  it('fetches a newer thumbnail unless this device is about to upload its own', () => {
    const r = remote(P, { thumbRev: '500' });
    expect(planSync([local(P, { thumbAt: 400, thumbRev: '400' })], [r])).toEqual([{ kind: 'thumb', id: P, remote: r }]);
    expect(planSync([local(P, { thumbAt: 600, thumbRev: '400' })], [r])).toEqual([]);
    expect(planSync([local(P, { thumbAt: 400, dirty: true })], [r])).toEqual([{ kind: 'push', id: P }]);
  });
});

describe('revisions', () => {
  it('the same on every device and the server, and the same as the revisions already in stores', async () => {
    const doc = defaultComposition();
    // How the server computed them before (node:crypto), so stored revisions still compare.
    const before = (name: string, d: unknown) => createHash('sha256').update(name).update('\n').update(JSON.stringify(d)).digest('base64url').slice(0, 22);
    for (const name of ['Pin', 'Café menu ✦ 2', '']) expect(await revisionOf(name, doc)).toBe(before(name, doc));
    expect(await revisionOf('Pin', structuredClone(doc))).toBe(await revisionOf('Pin', doc));
    expect(await revisionOf('Pin ', doc)).not.toBe(await revisionOf('Pin', doc));
    expect(await revisionOf('Pin', { ...doc, W: doc.W + 1 })).not.toBe(await revisionOf('Pin', doc));
  });
});

describe('names', () => {
  it('Untitled N counts past the highest one in use', () => {
    expect(untitledName([])).toBe('Untitled 1');
    expect(untitledName(['Untitled 1', 'Untitled 4', 'Pin'])).toBe('Untitled 5');
  });
  it('copies and this-device copies get a free name', () => {
    expect(copyName('Pin', ['Pin'])).toBe('Pin copy');
    expect(copyName('Pin', ['Pin', 'Pin copy', 'Pin copy 2'])).toBe('Pin copy 3');
    expect(deviceCopyName('Pin', ['Pin'])).toBe('Pin (this device)');
    expect(deviceCopyName('Pin', ['Pin (this device)'])).toBe('Pin (this device 2)');
  });
});

describe('files', () => {
  it('names image files by id and type', () => {
    expect(imageFileName('img_abc-123', 'image/png')).toBe('img_abc-123.png');
    expect(imageFileName('img_abc-123', 'image/jpeg')).toBe('img_abc-123.jpg');
    expect(imageFileName('img_abc-123', 'image/x-icon')).toBe('img_abc-123.img');
    expect(imageIdOf('img_abc-123.webp')).toBe('img_abc-123');
    expect(imageIdOf('../x.png')).toBeNull();
    expect(fileType('img_abc-123.jpg')).toBe('image/jpeg');
    expect(fileType('thumb.jpg')).toBe('image/jpeg');
  });

  it('allows uploads only to a project’s images (never overwritten) and its thumbnail', () => {
    expect(uploadRule(`projects/${P}/images/img_abcd-1234.png`)).toMatchObject({ projectId: P, contentTypes: ['image/*'], overwrite: false });
    expect(uploadRule(`projects/${P}/thumb.jpg`)).toMatchObject({ contentTypes: ['image/jpeg'], overwrite: true });
    for (const bad of [
      `projects/${P}/project.json`, 'projects/index.json', `projects/${P}/images/evil.html`, `projects/${P}/images/img_abcd/../../x.png`,
      'projects/prj_x/thumb.jpg', `other/${P}/thumb.jpg`, `projects/${P}/images/img_abcd-1234.png/x`,
    ]) expect(uploadRule(bad), bad).toBeNull();
  });

  it('merges image lists by name', () => {
    expect(mergeImages([{ name: 'a.png', size: 1 }], [{ name: 'a.png', size: 2 }, { name: 'b.png', size: 3 }])).toEqual([
      { name: 'a.png', size: 2 }, { name: 'b.png', size: 3 },
    ]);
  });

  it('syncs the stored images a canvas uses, not samples', () => {
    const d = defaultComposition();
    d.slots[1].imageId = 'img_aaaa-1111';
    d.background.imageId = 'img_bbbb-2222';
    expect(projectImageIds(d).sort()).toEqual(['img_aaaa-1111', 'img_bbbb-2222']);
    expect(referencedImageIds(d)).toContain(d.slots[0].imageId); // pruning keeps every id
  });

  it('rejects unusable listing entries', () => {
    expect(sanitizeRemote({ id: 'nope', name: 'x', rev: 'r', createdAt: 1, updatedAt: 1 })).toBeNull();
    expect(sanitizeRemote({ id: P, name: '  Pin  ', rev: 'r', createdAt: 1, updatedAt: 2 })).toEqual({ id: P, name: 'Pin', rev: 'r', createdAt: 1, updatedAt: 2, thumbRev: null });
  });
});

describe('thumbnails', () => {
  it('uploads a newer thumbnail at most every 15 minutes while editing, and on leaving', () => {
    const p = local(P, { thumbAt: 1000, thumbRev: '500', thumbUploadedAt: 900 });
    expect(thumbDue(p, 900 + 60_000, false)).toBe(false);
    expect(thumbDue(p, 900 + THUMB_UPLOAD_GAP, false)).toBe(true);
    expect(thumbDue(p, 900 + 60_000, true)).toBe(true);
    expect(thumbDue({ ...p, thumbRev: '1000' }, 10 ** 9, true)).toBe(false);
    expect(thumbDue(local(P), 10 ** 9, true)).toBe(false);
  });
});

describe('status', () => {
  it('says what the user needs to know', () => {
    expect(syncStatus('off', 'idle', true).label).toBe('Sync off');
    expect(syncStatus('blob', 'offline', false).label).toBe('Offline');
    expect(syncStatus('blob', 'syncing', false).label).toBe('Syncing…');
    expect(syncStatus('blob', 'idle', true).label).toBe('Saved on this device');
    expect(syncStatus('blob', 'error', false).label).toBe('Saved on this device');
    expect(syncStatus(null, 'unknown', false).label).toBe('Saved on this device');
    expect(syncStatus('local', 'idle', false).label).toBe('Synced');
  });

  it('says when a project was last edited', () => {
    const now = new Date(2026, 9, 25, 15, 0).getTime();
    expect(editedAgo(now - 20_000, now)).toBe('Just now');
    expect(editedAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(editedAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(editedAgo(new Date(2026, 9, 24, 20, 0).getTime(), now)).toBe('Yesterday');
    expect(editedAgo(new Date(2026, 9, 3, 12, 0).getTime(), now, 'en-US')).toBe('Oct 3');
    expect(editedAgo(new Date(2025, 9, 3, 12, 0).getTime(), now, 'en-US')).toBe('Oct 3, 2025');
  });
});
