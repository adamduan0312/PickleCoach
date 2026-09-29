import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookingLessonTitle } from '../src/domain/lessonOffering.js';

test('bookingLessonTitle prefers the snapshot, then the lesson, then a default', () => {
  assert.equal(
    bookingLessonTitle({ lesson_title_at_booking: 'Beginner Group Clinic', lesson: { title: 'Renamed' } }),
    'Beginner Group Clinic',
  );
  assert.equal(bookingLessonTitle({ lesson_title_at_booking: null, lesson: { title: 'Current title' } }), 'Current title');
  assert.equal(bookingLessonTitle({}), 'Lesson');
});

test('booking displays read the title through bookingLessonTitle', () => {
  for (const rel of [
    '../src/pages/bookings/BookingDetailPage.jsx',
    '../src/pages/bookings/BookingsListPage.jsx',
    '../src/pages/coach/CoachDashboardPage.jsx',
    '../src/pages/student/StudentDashboardPage.jsx',
    '../src/pages/admin/AdminBookingsPage.jsx',
    '../src/pages/admin/AdminDashboardPage.jsx',
    '../src/pages/admin/AdminDisputeDetailPage.jsx',
    '../src/pages/admin/AdminUserDetailPage.jsx',
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(src, /bookingLessonTitle\(/, rel);
    assert.doesNotMatch(src, /\.lesson\?\.title/, `${rel} should not read the live lesson title`);
  }
});
