import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COACH_PHOTO_MAX,
  COACH_PHOTO_MAX_BYTES,
  GALLERY_TITLE,
  galleryIntro,
  galleryLayout,
  moveItem,
  planCoachPhotoUpload,
  wrapIndex,
} from '../src/domain/coachPhotos.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const photos = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, url: `/uploads/coach-photos/${i + 1}.jpg` }));
const file = (name, type = 'image/jpeg', size = 1000) => ({ name, type, size });

test('gallery copy: "On the court" with the coach\'s first name', () => {
  assert.equal(GALLERY_TITLE, 'On the court');
  assert.equal(galleryIntro('Chris Martinez'), 'See Chris in action during lessons and on the court.');
  assert.equal(galleryIntro(''), 'See this coach in action during lessons and on the court.');
});

test('desktop layout: featured cover, up to two side tiles, "+N" for the rest', () => {
  assert.deepEqual(galleryLayout([]), { featured: null, side: [], moreCount: 0 });
  assert.deepEqual(galleryLayout(photos(1)).side, []);
  const five = galleryLayout(photos(5));
  assert.equal(five.featured.id, 1);
  assert.deepEqual(five.side.map((p) => p.id), [2, 3]);
  assert.equal(five.moreCount, 2);
  assert.equal(galleryLayout(photos(3)).moreCount, 0);
});

test('lightbox navigation wraps around', () => {
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(2, 5), 2);
  assert.equal(wrapIndex(3, 0), 0);
});

test('moveItem reorders without mutating', () => {
  const list = [1, 2, 3, 4];
  assert.deepEqual(moveItem(list, 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(moveItem(list, 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(moveItem(list, 0, 9), [1, 2, 3, 4]);
  assert.deepEqual(list, [1, 2, 3, 4]);
});

test('upload plan: type, size and the 8-photo cap', () => {
  const big = file('big.jpg', 'image/jpeg', COACH_PHOTO_MAX_BYTES + 1);
  const plan = planCoachPhotoUpload([file('a.jpg'), file('b.gif', 'image/gif'), big, file('c.webp', 'image/webp')], 0);
  assert.deepEqual(plan.accepted.map((f) => f.name), ['a.jpg', 'c.webp']);
  assert.equal(plan.problems.length, 2);

  const capped = planCoachPhotoUpload([file('a.jpg'), file('b.png', 'image/png'), file('c.jpg')], 6);
  assert.deepEqual(capped.accepted.map((f) => f.name), ['a.jpg', 'b.png']);
  assert.match(capped.problems[0], /add 2 more photos/);

  const full = planCoachPhotoUpload([file('a.jpg')], COACH_PHOTO_MAX);
  assert.deepEqual(full.accepted, []);
  assert.match(full.problems[0], /already have 8 photos/);
});

test('limits match the backend', () => {
  const backend = read('../../backend/utils/coachPhotos.js');
  assert.match(backend, /MAX_COACH_PHOTOS = 8;/);
  assert.match(backend, /MAX_COACH_PHOTO_BYTES = 5 \* 1024 \* 1024;/);
  assert.equal(COACH_PHOTO_MAX, 8);
  assert.equal(COACH_PHOTO_MAX_BYTES, 5 * 1024 * 1024);
});

test('public profile: gallery sits after About/Certifications and before Teaching locations', () => {
  const page = read('../src/pages/student/CoachPublicProfilePage.jsx');
  const about = page.indexOf('<h2>About</h2>');
  const certs = page.indexOf('<h2>Certifications</h2>');
  const gallery = page.indexOf('<CoachPhotoGallery');
  const locations = page.indexOf('<h2>Teaching locations</h2>');
  assert.ok(about < certs && certs < gallery && gallery < locations);
  assert.match(page, /photos=\{photos\} coachName=\{coach\.full_name\}/);
});

test('gallery is separate from the avatar and not a listing requirement', () => {
  const manager = read('../src/components/coach/CoachPhotosManager.jsx');
  const gallery = read('../src/components/coach/CoachPhotoGallery.jsx');
  for (const src of [manager, gallery]) assert.doesNotMatch(src, /avatar/i);
  assert.match(manager, /coachesApi\.uploadPhotos\(accepted\)/);
  assert.match(manager, /coachesApi\.reorderPhotos\(/);
  assert.match(manager, /coachesApi\.setCoverPhoto\(/);
  assert.match(manager, /coachesApi\.deletePhoto\(/);
  assert.equal((manager.match(/type="submit"/g) || []).length, 0, 'manager buttons never submit the profile form');
  assert.doesNotMatch(read('../src/domain/coachProfileCompleteness.js'), /photo/i);
  assert.doesNotMatch(read('../../backend/utils/coachProfileCompleteness.js'), /photo/i);
  assert.doesNotMatch(read('../../backend/services/coachMarketplaceEligibility.js'), /CoachPhoto|coach_photos/);
});

test('lightbox: dialog semantics, keyboard and swipe navigation', () => {
  const gallery = read('../src/components/coach/CoachPhotoGallery.jsx');
  assert.match(gallery, /role="dialog"/);
  assert.match(gallery, /aria-modal="true"/);
  assert.match(gallery, /e\.key === 'Escape'/);
  assert.match(gallery, /e\.key === 'ArrowRight'/);
  assert.match(gallery, /onTouchEnd=/);
});
