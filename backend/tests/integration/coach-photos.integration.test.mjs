/**
 * HTTP integration: coach "On the court" gallery.
 *
 *   1. Upload (multipart) → ordered list, first photo is the cover, files on disk.
 *   2. Public coach profile embeds the photos in order; avatar_url untouched.
 *   3. Set cover, reorder (validated), delete (next photo becomes cover, file removed).
 *   4. Limits and guards: 8-photo cap (nothing written on reject), file type, students, other coaches.
 *   5. Photos are not a listing requirement.
 *
 * Run from backend/: npm run test:integration
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, CoachPhoto, User } from '../../models/index.js';
import { getCoachMarketplaceEligibility } from '../../services/coachMarketplaceEligibility.js';
import {
  COACH_PHOTO_UPLOAD_DIR,
  deleteManagedCoachPhotoFile,
  resolveManagedCoachPhotoFile,
} from '../../utils/coachPhotoStorage.js';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, api } from '../helpers/httpApp.mjs';

let dbOk = false;
if (RUN) {
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    console.warn('[http-integration] DB unavailable:', e.message);
  }
}

const describeHttp = RUN && dbOk ? describe : describe.skip;

async function login(baseUrl, email, password) {
  const res = await api(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

async function upload(baseUrl, token, count, { type = 'image/png' } = {}) {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append('photos', new Blob([Buffer.from(`fake-image-${i}`)], { type }), `photo-${i}.png`);
  }
  const res = await fetch(`${baseUrl}/api/coaches/me/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, json: await res.json() };
}

const ids = (res) => res.json.data.photos.map((p) => p.id);

describeHttp('HTTP integration: coach photo gallery', () => {
  let server = null;
  let fixture = null;
  let other = null;
  let coachToken;
  let studentToken;
  let otherCoachToken;

  before(async () => {
    server = await startTestServer();
    fixture = await createBookingJourneyFixture();
    other = await createBookingJourneyFixture();
    coachToken = await login(server.baseUrl, fixture.coach.email, fixture.password);
    studentToken = await login(server.baseUrl, fixture.student.email, fixture.password);
    otherCoachToken = await login(server.baseUrl, other.coach.email, other.password);
  });

  after(async () => {
    try {
      const leftover = await CoachPhoto.findAll({ where: { coach_id: [fixture?.coach.id, other?.coach.id].filter(Boolean) } });
      leftover.forEach((p) => deleteManagedCoachPhotoFile(p.url));
      if (fixture) await fixture.cleanup();
      if (other) await other.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('photos are optional for listing', async () => {
    assert.equal((await getCoachMarketplaceEligibility(fixture.coach.id)).listed, true);
  });

  it('upload → ordered gallery with the first photo as cover; public profile embeds it', async () => {
    const res = await upload(server.baseUrl, coachToken, 3);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const photos = res.json.data.photos;
    assert.equal(photos.length, 3);
    assert.equal(res.json.data.max_photos, 8);
    assert.deepEqual(photos.map((p) => p.is_cover), [true, false, false]);
    for (const p of photos) {
      assert.match(p.url, /^\/uploads\/coach-photos\/\d+-[0-9a-f-]+\.png$/);
      assert.ok(fs.existsSync(resolveManagedCoachPhotoFile(p.url)), 'file stored on disk');
    }

    const publicRes = await api(server.baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, { token: studentToken });
    assert.equal(publicRes.status, 200, publicRes.text);
    assert.deepEqual(publicRes.json.data.photos.map((p) => p.id), photos.map((p) => p.id));
    const coach = await User.findByPk(fixture.coach.id);
    assert.equal(publicRes.json.data.avatar_url, coach.avatar_url ?? null, 'gallery does not touch the avatar');

    const fileRes = await fetch(`${server.baseUrl}${photos[0].url}`);
    assert.equal(fileRes.status, 200, 'photo is served from /uploads');
  });

  it('set cover moves a photo to the front; reorder validates the full list', async () => {
    const [a, b, c] = ids(await api(server.baseUrl, 'GET', '/api/coaches/me/photos', { token: coachToken }));

    const cover = await api(server.baseUrl, 'PUT', `/api/coaches/me/photos/${c}/cover`, { token: coachToken });
    assert.equal(cover.status, 200, cover.text);
    assert.deepEqual(ids(cover), [c, a, b]);
    assert.equal(cover.json.data.photos[0].is_cover, true);

    const bad = await api(server.baseUrl, 'PUT', '/api/coaches/me/photos/order', { token: coachToken, body: { photo_ids: [a, b] } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'coach_photo_order_invalid');

    const reorder = await api(server.baseUrl, 'PUT', '/api/coaches/me/photos/order', { token: coachToken, body: { photo_ids: [b, c, a] } });
    assert.equal(reorder.status, 200, reorder.text);
    assert.deepEqual(ids(reorder), [b, c, a]);
  });

  it('deleting the cover promotes the next photo and removes the file', async () => {
    const before = await api(server.baseUrl, 'GET', '/api/coaches/me/photos', { token: coachToken });
    const [cover, next] = before.json.data.photos;
    const res = await api(server.baseUrl, 'DELETE', `/api/coaches/me/photos/${cover.id}`, { token: coachToken });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.data.photos.length, 2);
    assert.equal(res.json.data.photos[0].id, next.id);
    assert.equal(res.json.data.photos[0].is_cover, true);
    assert.equal(fs.existsSync(resolveManagedCoachPhotoFile(cover.url)), false);
  });

  it('caps the gallery at 8 photos without writing anything on reject', async () => {
    const coachFiles = () => fs.readdirSync(COACH_PHOTO_UPLOAD_DIR).filter((f) => f.startsWith(`${fixture.coach.id}-`)).length;
    const filesBefore = coachFiles();
    const tooMany = await upload(server.baseUrl, coachToken, 7);
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.json.code, 'coach_photo_limit');
    assert.equal(tooMany.json.remaining, 6);
    assert.equal(await CoachPhoto.count({ where: { coach_id: fixture.coach.id } }), 2);
    assert.equal(coachFiles(), filesBefore, 'rejected uploads are discarded');

    const fill = await upload(server.baseUrl, coachToken, 6);
    assert.equal(fill.status, 201);
    assert.equal(fill.json.data.photos.length, 8);
    const full = await upload(server.baseUrl, coachToken, 1);
    assert.equal(full.status, 400);
    assert.equal(full.json.remaining, 0);
  });

  it('rejects non-image files', async () => {
    const res = await upload(server.baseUrl, otherCoachToken, 1, { type: 'text/plain' });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /JPG, PNG, or WebP/);
  });

  it('only the owning coach can manage photos', async () => {
    const [photo] = (await api(server.baseUrl, 'GET', '/api/coaches/me/photos', { token: coachToken })).json.data.photos;
    assert.equal((await upload(server.baseUrl, studentToken, 1)).status, 403);
    const del = await api(server.baseUrl, 'DELETE', `/api/coaches/me/photos/${photo.id}`, { token: otherCoachToken });
    assert.equal(del.status, 404);
    const cover = await api(server.baseUrl, 'PUT', `/api/coaches/me/photos/${photo.id}/cover`, { token: otherCoachToken });
    assert.equal(cover.status, 404);
    assert.equal(await CoachPhoto.count({ where: { id: photo.id } }), 1);
  });
});
