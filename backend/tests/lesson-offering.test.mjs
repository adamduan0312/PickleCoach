import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createLessonSchema,
  updateLessonSchema,
  createBookingIntentSchema,
  createBookingSchema,
} from '../config/validation.js';
import { resolveLessonOffering, hasCentsPrecision } from '../utils/lessonOffering.js';
import { BOOKING_SUMMARY_FIELD_NAMES, LESSON_SUMMARY_FIELD_NAMES } from '../utils/bookingDto.js';
import { PUBLIC_MARKETPLACE_LESSON_FIELDS } from '../utils/lessonDto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');

const base = { title: 'Private Lesson', duration_minutes: 60, price: 55 };
const create = (body) => createLessonSchema.validate({ ...base, ...body }, { convert: true, stripUnknown: true });
const update = (body) => updateLessonSchema.validate(body, { convert: true, stripUnknown: true });
const fieldOf = (error) => error?.details?.[0]?.path?.join('.');

describe('lesson type', () => {
  it('accepts private and group; defaults to private', () => {
    assert.equal(create({}).value.lesson_type, 'private');
    assert.equal(create({ lesson_type: 'private' }).error, undefined);
    assert.equal(create({ lesson_type: 'group', max_players: 4 }).error, undefined);
  });

  it('rejects other lesson types', () => {
    const { error } = create({ lesson_type: 'clinic' });
    assert.equal(fieldOf(error), 'lesson_type');
    assert.match(error.message, /Private or Group/);
  });

  it('migration backfills existing lessons to private with no max players', () => {
    const src = read('../migrations/20260929120000-lessons-lesson-type-max-players.cjs');
    assert.match(src, /defaultValue: 'private'/);
    assert.match(src, /UPDATE lessons SET lesson_type = 'private', max_players = NULL/);
  });
});

describe('maximum players', () => {
  it('group requires a maximum', () => {
    const r = resolveLessonOffering({ lesson_type: 'group' });
    assert.equal(r.ok, false);
    assert.equal(r.field, 'max_players');
  });

  it('private does not require a maximum and always stores null', () => {
    assert.deepEqual(resolveLessonOffering({ lesson_type: 'private' }), { ok: true, lesson_type: 'private', max_players: null });
    assert.deepEqual(resolveLessonOffering({ lesson_type: 'private', max_players: 6 }), { ok: true, lesson_type: 'private', max_players: null });
    assert.deepEqual(resolveLessonOffering({}), { ok: true, lesson_type: 'private', max_players: null });
  });

  it('group keeps a valid maximum', () => {
    assert.deepEqual(resolveLessonOffering({ lesson_type: 'group', max_players: 6 }), { ok: true, lesson_type: 'group', max_players: 6 });
  });

  it('partial updates reuse the stored group maximum, and switching to group needs one', () => {
    const groupRow = { lesson_type: 'group', max_players: 6 };
    assert.deepEqual(resolveLessonOffering({ title: 'x' }, groupRow), { ok: true, lesson_type: 'group', max_players: 6 });
    assert.equal(resolveLessonOffering({ lesson_type: 'group' }, { lesson_type: 'private', max_players: null }).ok, false);
    assert.deepEqual(resolveLessonOffering({ lesson_type: 'private' }, groupRow), { ok: true, lesson_type: 'private', max_players: null });
  });

  it('rejects out-of-range or non-integer maximums', () => {
    for (const bad of [1, 13, 2.5, 'lots']) {
      const { error } = create({ lesson_type: 'group', max_players: bad });
      assert.equal(fieldOf(error), 'max_players', `max_players=${bad}`);
    }
    assert.equal(create({ lesson_type: 'group', max_players: 2 }).error, undefined);
    assert.equal(create({ lesson_type: 'group', max_players: 12 }).error, undefined);
  });
});

describe('description', () => {
  it('empty description is valid on create and edit', () => {
    assert.equal(create({ description: '' }).error, undefined);
    assert.equal(update({ description: '' }).error, undefined);
  });

  it('non-empty description still works; over 1000 characters is rejected', () => {
    assert.equal(create({ description: 'Drills for 3.5+ players — 90 min.' }).value.description, 'Drills for 3.5+ players — 90 min.');
    assert.equal(fieldOf(create({ description: 'x'.repeat(1001) }).error), 'description');
  });
});

describe('existing lesson validation', () => {
  it('trims titles and rejects blank or too-short titles', () => {
    assert.equal(create({ title: '  Morning drills  ' }).value.title, 'Morning drills');
    assert.match(create({ title: '     ' }).error.message, /Enter a lesson title/);
    assert.match(create({ title: ' ab ' }).error.message, /at least 3 characters/);
    assert.equal(fieldOf(create({ title: 'x'.repeat(256) }).error), 'title');
  });

  it('allows numbers and punctuation in titles', () => {
    assert.equal(create({ title: '2-hour clinic (3.5+)' }).error, undefined);
  });

  it('duration must be a whole number from 15 to 480', () => {
    assert.equal(create({ duration_minutes: 45 }).error, undefined);
    for (const bad of [60.5, 10, 500]) {
      assert.equal(fieldOf(create({ duration_minutes: bad }).error), 'duration_minutes', `duration=${bad}`);
    }
  });

  it('price keeps the minimum, allows cents, rejects sub-cent precision and typo-size prices', () => {
    assert.equal(create({ price: 55.25 }).error, undefined);
    assert.equal(create({ price: 1000 }).error, undefined);
    assert.equal(fieldOf(create({ price: 0.1 }).error), 'price');
    assert.match(create({ price: 55.255 }).error.message, /two decimal places/);
    assert.equal(fieldOf(create({ price: 5500 }).error), 'price');
    assert.equal(hasCentsPrecision(19.99), true);
  });
});

describe('group lessons keep the one-student booking model', () => {
  it('lesson type is exposed to students and bookings as offering info only', () => {
    assert.ok(PUBLIC_MARKETPLACE_LESSON_FIELDS.includes('lesson_type'));
    assert.ok(LESSON_SUMMARY_FIELD_NAMES.includes('max_players'));
    assert.ok(BOOKING_SUMMARY_FIELD_NAMES.includes('lesson_type_at_booking'));
    assert.ok(BOOKING_SUMMARY_FIELD_NAMES.includes('max_players_at_booking'));
  });

  it('booking requests still forbid extra players', () => {
    const body = { lesson_id: 1, scheduled_at: new Date(Date.now() + 86400000).toISOString(), court_location_id: 1, player_ids: [2, 3] };
    assert.ok(createBookingIntentSchema.validate(body).error);
    assert.ok(createBookingSchema.validate(body).error);
  });

  it('booking confirm only snapshots lesson_type / max_players onto the booking', () => {
    const src = read('../services/bookingIntentService.js');
    const snapshotLines = [
      'lesson_type_at_booking: lesson.lesson_type,',
      'max_players_at_booking: lesson.max_players,',
    ];
    const createBlock = src.slice(src.indexOf('Booking.create('), src.indexOf('Payment.create('));
    for (const line of snapshotLines) {
      assert.equal(src.split(line).length - 1, 1, `expected exactly one "${line}"`);
      assert.ok(createBlock.includes(line), `"${line}" must be inside Booking.create`);
    }
    const rest = snapshotLines.reduce((acc, line) => acc.replace(line, ''), src);
    assert.doesNotMatch(rest, /lesson_type|max_players/, 'bookingIntentService should not otherwise use lesson offering');
  });

  it('availability, payment, and booking controller code ignore lesson_type and max_players', () => {
    for (const rel of [
      '../services/bookingService.js',
      '../services/paymentService.js',
      '../controllers/bookingController.js',
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /lesson_type|max_players/, `${rel} should not branch on lesson offering`);
    }
  });

  it('a booking is still one primary student, one coach, one payment, one occupied slot', () => {
    const intentSrc = read('../services/bookingIntentService.js');
    assert.match(intentSrc, /primary_student_id: studentId/);
    assert.equal((intentSrc.match(/Booking\.create\(/g) || []).length, 1);
    assert.equal((intentSrc.match(/Payment\.create\(/g) || []).length, 1);
    const bookingSrc = read('../services/bookingService.js');
    assert.match(bookingSrc, /coach_id: coachId,\s*status: \{ \[Op\.in\]: \['pending', 'confirmed', 'awaiting_verification'\] \}/);
  });
});
