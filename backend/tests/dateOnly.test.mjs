import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAvailabilitySchema } from '../config/validation.js';
import { normalizeYmdString, calendarDateInTimezone, toYmdApi } from '../utils/dateOnly.js';

test('normalizeYmdString trims and validates YYYY-MM-DD', () => {
  assert.equal(normalizeYmdString(' 2026-06-04 '), '2026-06-04');
  assert.equal(normalizeYmdString('not-a-date'), null);
  assert.equal(normalizeYmdString(null), null);
});

test('calendarDateInTimezone uses IANA calendar day', () => {
  const d = new Date('2026-06-05T04:00:00.000Z');
  assert.equal(calendarDateInTimezone(d, 'America/Los_Angeles'), '2026-06-04');
  assert.equal(calendarDateInTimezone(d, 'UTC'), '2026-06-05');
});

test('toYmdApi preserves leading YYYY-MM-DD from strings', () => {
  assert.equal(toYmdApi('2026-01-01'), '2026-01-01');
  assert.equal(toYmdApi('2026-01-01T00:00:00.000Z'), '2026-01-01');
  const u = new Date(Date.UTC(2026, 0, 1));
  assert.equal(toYmdApi(u), '2026-01-01');
});

test('createAvailabilitySchema keeps start_date and end_date as plain YMD strings', () => {
  const { value, error } = createAvailabilitySchema.validate({
    weekday: 'monday',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    start_time: '09:00',
    end_time: '17:00',
  });
  assert.equal(error, undefined);
  assert.equal(typeof value.start_date, 'string');
  assert.equal(value.start_date, '2026-01-01');
  assert.equal(value.end_date, '2026-12-31');
});
