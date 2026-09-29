import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { courtLocationAsBooked } from '../utils/courtAddressVisibility.js';
import {
  BOOKING_SUMMARY_FIELD_NAMES,
  serializeBookingDetailPayload,
  serializeBookingListItem,
  serializeBookingSummary,
} from '../utils/bookingDto.js';
import { buildLessonReminderDetailFields } from '../utils/lessonReminderCopy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');

const liveCourt = {
  id: 9,
  name: 'Renamed Court',
  address_line1: '1 New St',
  city: 'Queens',
  state: 'NY',
  postal_code: '11101',
  country: 'US',
  is_private: false,
  latitude: 40.7,
  longitude: -73.9,
};

const snapshotCols = {
  court_location_id: 9,
  court_name_at_booking: 'Pending-Stripe Court C — McCarren Park',
  court_address_line1_at_booking: '776 Lorimer St',
  court_city_at_booking: 'Brooklyn',
  court_state_at_booking: 'NY',
  court_postal_code_at_booking: '11222',
  court_country_at_booking: 'US',
  court_is_private_at_booking: false,
  court_latitude_at_booking: 40.72,
  court_longitude_at_booking: -73.95,
};

const booking = (overrides = {}) => ({
  id: 1,
  lesson_id: 3,
  coach_id: 7,
  primary_student_id: 8,
  scheduled_at: '2026-09-30T15:00:00.000Z',
  duration_minutes: 60,
  price: '55.00',
  status: 'confirmed',
  lesson_title_at_booking: 'Beginner Group Clinic',
  lesson_type_at_booking: 'group',
  max_players_at_booking: 6,
  ...snapshotCols,
  lesson: { id: 3, title: 'Private Lesson', duration_minutes: 90, price: '75.00', lesson_type: 'private', max_players: null },
  courtLocation: liveCourt,
  ...overrides,
});

describe('courtLocationAsBooked', () => {
  it('uses the snapshot over the edited live court, keeping the court id link', () => {
    const c = courtLocationAsBooked(booking(), liveCourt);
    assert.equal(c.id, 9);
    assert.equal(c.name, 'Pending-Stripe Court C — McCarren Park');
    assert.equal(c.address_line1, '776 Lorimer St');
    assert.equal(c.city, 'Brooklyn');
    assert.equal(c.postal_code, '11222');
    assert.equal(c.latitude, 40.72);
  });

  it('falls back to the live court for legacy bookings without a snapshot', () => {
    const legacy = { court_location_id: 9, court_name_at_booking: null };
    assert.deepEqual(courtLocationAsBooked(legacy, liveCourt), liveCourt);
    assert.equal(courtLocationAsBooked(legacy, null), null);
  });

  it('still works when the live court row is gone', () => {
    const c = courtLocationAsBooked(booking(), null);
    assert.equal(c.id, 9);
    assert.equal(c.name, 'Pending-Stripe Court C — McCarren Park');
  });
});

describe('booking DTOs use the snapshot', () => {
  it('detail and list embed the court as booked, not the edited court', () => {
    const detail = serializeBookingDetailPayload(booking());
    assert.equal(detail.courtLocation.name, 'Pending-Stripe Court C — McCarren Park');
    assert.equal(detail.courtLocation.address_line1, '776 Lorimer St');
    assert.equal(detail.courtLocation.area, 'Brooklyn, NY 11222');
    const row = serializeBookingListItem(booking());
    assert.equal(row.courtLocation.name, 'Pending-Stripe Court C — McCarren Park');
  });

  it('exposes lesson_title_at_booking; duration and price stay the booking values', () => {
    const dto = serializeBookingDetailPayload(booking());
    assert.equal(dto.lesson_title_at_booking, 'Beginner Group Clinic');
    assert.equal(dto.duration_minutes, 60);
    assert.equal(dto.price, '55.00');
    assert.equal(dto.lesson.title, 'Private Lesson');
  });

  it('never returns raw court snapshot columns (they bypass redaction)', () => {
    const summary = serializeBookingSummary(booking());
    const detail = serializeBookingDetailPayload(booking());
    for (const obj of [summary, detail]) {
      for (const key of Object.keys(obj)) {
        assert.ok(!key.startsWith('court_') || key === 'court_location_id', `unexpected ${key}`);
      }
    }
    assert.equal(BOOKING_SUMMARY_FIELD_NAMES.some((f) => f.startsWith('court_') && f.endsWith('_at_booking')), false);
  });
});

describe('private court redaction applies to the snapshot', () => {
  const privateSnap = { court_is_private_at_booking: true };

  it('pending booking: student sees only the area, coach sees the exact address', () => {
    const b = booking({ ...privateSnap, status: 'pending' });
    const student = serializeBookingDetailPayload(b, { viewerIsPrivileged: false });
    assert.equal(student.courtLocation.address_line1, null);
    assert.equal(student.courtLocation.latitude, null);
    assert.equal(student.courtLocation.area, 'Brooklyn, NY 11222');
    const coach = serializeBookingDetailPayload(b, { viewerIsPrivileged: true });
    assert.equal(coach.courtLocation.address_line1, '776 Lorimer St');
  });

  it('confirmed booking reveals the snapshot address to the student', () => {
    const dto = serializeBookingDetailPayload(booking({ ...privateSnap, status: 'confirmed' }));
    assert.equal(dto.courtLocation.address_line1, '776 Lorimer St');
  });

  it('court made public later does not unredact a snapshot taken while private', () => {
    const b = booking({ ...privateSnap, status: 'pending', courtLocation: { ...liveCourt, is_private: false } });
    assert.equal(serializeBookingDetailPayload(b).courtLocation.address_line1, null);
  });
});

describe('reminder emails use the snapshot', () => {
  it('title and court come from the booking snapshot', () => {
    const f = buildLessonReminderDetailFields(booking(), 'America/New_York', { audience: 'student' });
    assert.equal(f.lesson_title, 'Beginner Group Clinic');
    assert.equal(f.court_name, 'Pending-Stripe Court C — McCarren Park');
    assert.equal(f.court_address, '776 Lorimer St, Brooklyn, NY 11222');
  });

  it('legacy booking falls back to the live lesson title and court', () => {
    const legacy = booking({ lesson_title_at_booking: null, court_name_at_booking: null });
    const f = buildLessonReminderDetailFields(legacy, 'America/New_York', { audience: 'student' });
    assert.equal(f.lesson_title, 'Private Lesson');
    assert.equal(f.court_name, 'Renamed Court');
  });

  it('private snapshot on a pending booking stays redacted for the student', () => {
    const f = buildLessonReminderDetailFields(
      booking({ court_is_private_at_booking: true, status: 'pending' }),
      'America/New_York',
      { audience: 'student' },
    );
    assert.equal(f.court_address_revealed, false);
  });
});

describe('booking creation copies the snapshot only inside Booking.create', () => {
  it('title and court snapshot lines live in the single Booking.create call', () => {
    const src = read('../services/bookingIntentService.js');
    const createBlock = src.slice(src.indexOf('Booking.create('), src.indexOf('Payment.create('));
    for (const line of [
      'lesson_title_at_booking: lesson.title,',
      'court_name_at_booking: court.name,',
      'court_address_line1_at_booking: court.address_line1,',
      'court_city_at_booking: court.city,',
      'court_state_at_booking: court.state,',
      'court_postal_code_at_booking: court.postal_code,',
      'court_country_at_booking: court.country,',
      'court_is_private_at_booking: court.is_private,',
      'court_latitude_at_booking: court.latitude,',
      'court_longitude_at_booking: court.longitude,',
    ]) {
      assert.equal(src.split(line).length - 1, 1, `expected exactly one "${line}"`);
      assert.ok(createBlock.includes(line), `"${line}" must be inside Booking.create`);
    }
    assert.equal((src.match(/_at_booking/g) || []).length, 12);
  });
});
