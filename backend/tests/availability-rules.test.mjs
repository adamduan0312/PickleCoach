import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  AVAILABILITY_MAX_MONTHS_AHEAD,
  addMonthsYmd,
  availabilityConflictMessage,
  formatTimeOfDay12h,
  isRealCalendarDate,
  validateAvailabilityDates,
} from '../utils/availabilityRules.js';
import { createAvailabilitySchema, updateAvailabilitySchema } from '../config/validation.js';

const joi = (value) => createAvailabilitySchema.validate(value, { abortEarly: false, convert: true });
const details = (value) => (joi(value).error?.details || []).map((d) => [d.path.join('.'), d.message]);
const base = { weekday: 1, start_time: '09:00', end_time: '12:00' };

describe('availability: real calendar dates', () => {
  it('rejects impossible dates and accepts leap days only in leap years', () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2025-02-29', '2026-04-31', '2026-00-10', '2026-1-5', 'soon']) {
      assert.equal(isRealCalendarDate(bad), false, bad);
    }
    for (const good of ['2026-01-31', '2028-02-29', '2026-12-31']) assert.equal(isRealCalendarDate(good), true, good);
  });

  it('schema reports which date is invalid', () => {
    assert.deepEqual(details({ ...base, start_date: '2026-13-45' }), [['start_date', 'Start date must be a real calendar date (YYYY-MM-DD).']]);
    assert.deepEqual(details({ ...base, end_date: '2026-02-30' }), [['end_date', 'End date must be a real calendar date (YYYY-MM-DD).']]);
    assert.equal(joi({ ...base, start_date: '', end_date: null }).error, undefined);
    assert.equal(updateAvailabilitySchema, createAvailabilitySchema);
  });

  it('schema puts order errors on the right field', () => {
    assert.deepEqual(details({ ...base, start_time: '16:00', end_time: '09:00' }).map(([f]) => f), ['end_time']);
    assert.match(details({ ...base, start_time: '22:00', end_time: '02:00' })[0][1], /can’t cross midnight/);
    assert.deepEqual(details({ ...base, start_date: '2026-12-01', end_date: '2026-11-01' }), [['end_date', 'End date must be on or after the start date.']]);
  });
});

describe('availability: past and far-future dates (relative to the coach’s today)', () => {
  const today = '2026-09-30';

  it('rejects a range that has already ended, allows a past start with a future or open end', () => {
    const past = validateAvailabilityDates({ start_date: '2026-01-01', end_date: '2026-09-29' }, { today });
    assert.equal(past.ok, false);
    assert.equal(past.field, 'end_date');
    assert.match(past.message, /Sep 29, 2026 has already passed/);
    assert.deepEqual(validateAvailabilityDates({ start_date: null, end_date: today }, { today }), { ok: true });
    assert.deepEqual(validateAvailabilityDates({ start_date: '2026-01-01', end_date: null }, { today }), { ok: true });
    assert.deepEqual(validateAvailabilityDates({ start_date: null, end_date: null }, { today }), { ok: true });
  });

  it('caps start and end dates at 24 months ahead', () => {
    assert.equal(AVAILABILITY_MAX_MONTHS_AHEAD, 24);
    assert.deepEqual(validateAvailabilityDates({ start_date: '2028-09-30', end_date: '2028-09-30' }, { today }), { ok: true });
    const start = validateAvailabilityDates({ start_date: '2028-10-01', end_date: null }, { today });
    assert.deepEqual([start.ok, start.field], [false, 'start_date']);
    assert.match(start.message, /at most 24 months ahead \(latest Sep 30, 2028\)/);
    const end = validateAvailabilityDates({ start_date: null, end_date: '9999-12-31' }, { today });
    assert.deepEqual([end.ok, end.field], [false, 'end_date']);
  });

  it('month math clamps to the end of the month', () => {
    assert.equal(addMonthsYmd('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonthsYmd('2028-02-29', 12), '2029-02-28');
    assert.equal(addMonthsYmd('2026-11-15', 2), '2027-01-15');
  });

  it('controller checks dates in the coach’s timezone before create and update', () => {
    const src = readFileSync(new URL('../controllers/coachController.js', import.meta.url), 'utf8');
    assert.match(src, /calendarDateInTimezone\(new Date\(\), req\.user\.timezone \|\| 'UTC'\)/);
    assert.equal((src.match(/const dates = checkAvailabilityDates\(req, resolvedStartDate, resolvedEndDate\);/g) || []).length, 2);
    assert.doesNotMatch(src, /Use a non-overlapping time window/);
  });
});

describe('availability: conflict messages name the window and the explicit fixes', () => {
  const mon912 = { start_time: '09:00:00', end_time: '12:00:00' };

  it('extending past the end', () => {
    assert.equal(
      availabilityConflictMessage({ weekday: 1, existing: mon912, requested: { start_time: '09:00:00', end_time: '16:00:00' } }),
      'This overlaps your Monday 9:00 AM–12:00 PM window. Edit that window to 9:00 AM–4:00 PM, or add 12:00 PM–4:00 PM instead.',
    );
  });

  it('extending on both sides lists both uncovered parts', () => {
    assert.equal(
      availabilityConflictMessage({ weekday: 1, existing: mon912, requested: { start_time: '08:00', end_time: '13:30' } }),
      'This overlaps your Monday 9:00 AM–12:00 PM window. Edit that window to 8:00 AM–1:30 PM, or add 8:00 AM–9:00 AM and 12:00 PM–1:30 PM instead.',
    );
  });

  it('fully covered time says so instead of suggesting a change', () => {
    assert.equal(
      availabilityConflictMessage({ weekday: 1, existing: mon912, requested: { start_time: '10:00', end_time: '11:00' } }),
      'This time is already covered by your Monday 9:00 AM–12:00 PM window.',
    );
  });

  it('includes the existing window’s date range when it has one', () => {
    const msg = availabilityConflictMessage({
      weekday: 3,
      existing: { ...mon912, start_date: '2026-10-01', end_date: '2026-12-31' },
      requested: { start_time: '11:00', end_time: '14:00' },
    });
    assert.match(msg, /^This overlaps your Wednesday 9:00 AM–12:00 PM window \(Oct 1, 2026 – Dec 31, 2026\)\./);
  });

  it('12-hour formatting', () => {
    assert.deepEqual(['00:00', '09:05:00', '12:00', '23:30'].map(formatTimeOfDay12h), ['12:00 AM', '9:05 AM', '12:00 PM', '11:30 PM']);
  });
});
