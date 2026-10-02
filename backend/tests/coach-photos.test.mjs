/**
 * Coach gallery ordering rules + managed file path safety.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import {
  orderCoachPhotos,
  orderWithCover,
  serializeCoachPhotoList,
  validateCoachPhotoOrder,
} from '../utils/coachPhotos.js';
import {
  COACH_PHOTO_UPLOAD_DIR,
  publicPathForCoachPhotoFilename,
  resolveManagedCoachPhotoFile,
} from '../utils/coachPhotoStorage.js';
import { serializeCoachPublicUser } from '../utils/userDto.js';

const rows = [
  { id: 11, url: '/uploads/coach-photos/b.jpg', position: 1, coach_id: 5 },
  { id: 12, url: '/uploads/coach-photos/c.jpg', position: 2, coach_id: 5 },
  { id: 10, url: '/uploads/coach-photos/a.jpg', position: 0, coach_id: 5 },
];

describe('coach photo ordering', () => {
  it('orders by position and marks only the first as cover', () => {
    assert.deepEqual(orderCoachPhotos(rows).map((p) => p.id), [10, 11, 12]);
    assert.deepEqual(serializeCoachPhotoList(rows), [
      { id: 10, url: '/uploads/coach-photos/a.jpg', is_cover: true },
      { id: 11, url: '/uploads/coach-photos/b.jpg', is_cover: false },
      { id: 12, url: '/uploads/coach-photos/c.jpg', is_cover: false },
    ]);
  });

  it('breaks position ties by id', () => {
    assert.deepEqual(orderCoachPhotos([{ id: 3, position: 0 }, { id: 2, position: 0 }]).map((p) => p.id), [2, 3]);
  });

  it('set cover moves the photo to the front and keeps the rest in order', () => {
    assert.deepEqual(orderWithCover([10, 11, 12], 12), [12, 10, 11]);
    assert.deepEqual(orderWithCover([10, 11, 12], 10), [10, 11, 12]);
  });

  it('reorder must list every photo exactly once', () => {
    assert.deepEqual(validateCoachPhotoOrder([10, 11, 12], [12, 10, 11]), { ok: true, ids: [12, 10, 11] });
    assert.equal(validateCoachPhotoOrder([10, 11, 12], [12, 10]).ok, false);
    assert.equal(validateCoachPhotoOrder([10, 11, 12], [12, 10, 10]).ok, false);
    assert.equal(validateCoachPhotoOrder([10, 11, 12], [12, 10, 99]).ok, false);
    assert.equal(validateCoachPhotoOrder([10, 11], 'nope').ok, false);
  });
});

describe('coach photo storage paths', () => {
  it('resolves only managed basenames inside the upload dir', () => {
    const p = publicPathForCoachPhotoFilename('5-abc.jpg');
    assert.equal(p, '/uploads/coach-photos/5-abc.jpg');
    assert.equal(resolveManagedCoachPhotoFile(p), path.join(COACH_PHOTO_UPLOAD_DIR, '5-abc.jpg'));
    assert.equal(resolveManagedCoachPhotoFile('/uploads/coach-photos/../avatars/x.jpg'), null);
    assert.equal(resolveManagedCoachPhotoFile('/uploads/coach-photos/a/b.jpg'), null);
    assert.equal(resolveManagedCoachPhotoFile('/uploads/avatars/x.jpg'), null);
    assert.equal(resolveManagedCoachPhotoFile('https://cdn.example.com/x.jpg'), null);
  });
});

describe('public coach payload', () => {
  it('embeds ordered photos separately from avatar_url', () => {
    const out = serializeCoachPublicUser({ id: 5, full_name: 'Chris', avatar_url: '/uploads/avatars/me.jpg', coachPhotos: rows });
    assert.equal(out.avatar_url, '/uploads/avatars/me.jpg');
    assert.deepEqual(out.photos.map((p) => p.id), [10, 11, 12]);
    assert.equal(out.photos[0].is_cover, true);
    assert.equal(out.photos[0].coach_id, undefined);
  });

  it('omits photos when the association was not loaded', () => {
    assert.equal(serializeCoachPublicUser({ id: 5, full_name: 'Chris' }).photos, undefined);
  });
});
