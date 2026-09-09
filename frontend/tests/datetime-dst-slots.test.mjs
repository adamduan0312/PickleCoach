/**
 * DST / slot-generation contract for America/New_York 2026:
 *   Spring forward: 2026-03-08 02:00 → 03:00 (2:00–2:59 do not exist)
 *   Fall back:      2026-11-01 02:00 → 01:00 (1:00–1:59 occur twice)
 *
 * Slots are generated in the coach timezone; the student UI only reformats
 * the same UTC `scheduled_at` into the viewer timezone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAvailabilitySlots,
  formatTimeInZone,
  groupSlotsByDate,
  zonedWallTimeToUtc,
} from '../src/utils/datetime.js';

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const PHOENIX = 'America/Phoenix';

function localHms(iso, timeZone) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

function sundayWindow(start, end) {
  return [{ weekday: 0, start_time: start, end_time: end }];
}

describe('zonedWallTimeToUtc round-trip (non-DST and DST boundaries)', () => {
  it('ordinary EST/EDT times round-trip to the same local wall clock', () => {
    const winter = zonedWallTimeToUtc('2026-01-15', '10:00:00', NY);
    const summer = zonedWallTimeToUtc('2026-07-15', '10:00:00', NY);
    assert.equal(localHms(winter.toISOString(), NY), '2026-01-15 10:00:00');
    assert.equal(localHms(summer.toISOString(), NY), '2026-07-15 10:00:00');
    assert.equal(winter.toISOString(), '2026-01-15T15:00:00.000Z');
    assert.equal(summer.toISOString(), '2026-07-15T14:00:00.000Z');
  });

  it('the day before and after spring-forward keep 2:30 AM', () => {
    const before = zonedWallTimeToUtc('2026-03-07', '02:30:00', NY);
    const after = zonedWallTimeToUtc('2026-03-09', '02:30:00', NY);
    assert.equal(localHms(before.toISOString(), NY), '2026-03-07 02:30:00');
    assert.equal(localHms(after.toISOString(), NY), '2026-03-09 02:30:00');
  });

  it('spring-forward gap: 2:00 and 2:30 AM do not exist; 3:00 AM is 3:00 AM EDT', () => {
    assert.equal(zonedWallTimeToUtc('2026-03-08', '02:00:00', NY), null);
    assert.equal(zonedWallTimeToUtc('2026-03-08', '02:30:00', NY), null);
    const three = zonedWallTimeToUtc('2026-03-08', '03:00:00', NY);
    assert.ok(three);
    assert.equal(three.toISOString(), '2026-03-08T07:00:00.000Z');
    assert.equal(localHms(three.toISOString(), NY), '2026-03-08 03:00:00');
    const one = zonedWallTimeToUtc('2026-03-08', '01:00:00', NY);
    assert.equal(one.toISOString(), '2026-03-08T06:00:00.000Z');
    assert.equal(localHms(one.toISOString(), NY), '2026-03-08 01:00:00');
  });

  it('fall-back: 1:00 AM is a single earlier instant; 2:00 AM is 2:00 AM', () => {
    const one = zonedWallTimeToUtc('2026-11-01', '01:00:00', NY);
    const two = zonedWallTimeToUtc('2026-11-01', '02:00:00', NY);
    assert.equal(one.toISOString(), '2026-11-01T05:00:00.000Z');
    assert.equal(localHms(one.toISOString(), NY), '2026-11-01 01:00:00');
    assert.equal(two.toISOString(), '2026-11-01T07:00:00.000Z');
    assert.equal(localHms(two.toISOString(), NY), '2026-11-01 02:00:00');
  });

  it('Phoenix (no DST) keeps 2:30 AM on the US spring-forward date', () => {
    const utc = zonedWallTimeToUtc('2026-03-08', '02:30:00', PHOENIX);
    assert.ok(utc);
    assert.equal(localHms(utc.toISOString(), PHOENIX), '2026-03-08 02:30:00');
  });
});

describe('buildAvailabilitySlots across DST', () => {
  const overnightSunday = sundayWindow('01:00:00', '04:00:00');

  it('spring-forward Sunday omits the gap and does not shift 3:00 AM to 4:00 AM', () => {
    const slots = buildAvailabilitySlots({
      availabilities: overnightSunday,
      durationMinutes: 30,
      coachTimezone: NY,
      daysAhead: 14,
      now: new Date('2026-03-01T12:00:00.000Z'),
      minLeadHours: 0,
    });
    const labels = slots
      .filter((s) => localHms(s.scheduled_at, NY).startsWith('2026-03-08'))
      .map((s) => formatTimeInZone(s.scheduled_at, NY));
    assert.deepEqual(labels, ['1:00 AM', '1:30 AM', '3:00 AM', '3:30 AM']);
    assert.equal(slots.filter((s) => s.scheduled_at === '2026-03-08T07:00:00.000Z').length, 1);
  });

  it('fall-back Sunday does not show two slots with the same 1:00 AM label', () => {
    const slots = buildAvailabilitySlots({
      availabilities: overnightSunday,
      durationMinutes: 30,
      coachTimezone: NY,
      daysAhead: 14,
      now: new Date('2026-10-25T12:00:00.000Z'),
      minLeadHours: 0,
    });
    const day = slots.filter((s) => localHms(s.scheduled_at, NY).startsWith('2026-11-01'));
    const labels = day.map((s) => formatTimeInZone(s.scheduled_at, NY));
    assert.deepEqual(labels, ['1:00 AM', '1:30 AM', '2:00 AM', '2:30 AM', '3:00 AM', '3:30 AM']);
    assert.equal(new Set(day.map((s) => s.scheduled_at)).size, day.length);
    assert.equal(new Set(labels).size, labels.length);
  });

  it('weekday windows immediately before, on, and after the spring transition stay 10:00 AM local', () => {
    const weekdayWindows = [5, 6, 0, 1].map((weekday) => ({
      weekday,
      start_time: '10:00:00',
      end_time: '11:00:00',
    }));
    const slots = buildAvailabilitySlots({
      availabilities: weekdayWindows,
      durationMinutes: 60,
      coachTimezone: NY,
      daysAhead: 10,
      now: new Date('2026-03-05T12:00:00.000Z'),
      minLeadHours: 0,
    });
    const byYmd = Object.fromEntries(
      slots
        .filter((s) => {
          const ymd = localHms(s.scheduled_at, NY).slice(0, 10);
          return ymd >= '2026-03-06' && ymd <= '2026-03-09';
        })
        .map((s) => [localHms(s.scheduled_at, NY).slice(0, 10), s.scheduled_at]),
    );
    assert.equal(localHms(byYmd['2026-03-06'], NY), '2026-03-06 10:00:00');
    assert.equal(localHms(byYmd['2026-03-07'], NY), '2026-03-07 10:00:00');
    assert.equal(localHms(byYmd['2026-03-08'], NY), '2026-03-08 10:00:00');
    assert.equal(localHms(byYmd['2026-03-09'], NY), '2026-03-09 10:00:00');
    assert.equal(byYmd['2026-03-07'], '2026-03-07T15:00:00.000Z');
    assert.equal(byYmd['2026-03-08'], '2026-03-08T14:00:00.000Z');
  });
});

describe('student timezone vs coach timezone', () => {
  it('the booked ISO is generated in the coach zone; the student only sees a label', () => {
    const slots = buildAvailabilitySlots({
      availabilities: [{ weekday: 1, start_time: '09:00:00', end_time: '10:00:00' }],
      durationMinutes: 60,
      coachTimezone: NY,
      daysAhead: 14,
      now: new Date('2026-06-01T12:00:00.000Z'),
      minLeadHours: 0,
    });
    const monday = slots.find((s) => localHms(s.scheduled_at, NY).includes(' 09:00:00'));
    assert.ok(monday);
    assert.equal(formatTimeInZone(monday.scheduled_at, NY), '9:00 AM');
    assert.equal(formatTimeInZone(monday.scheduled_at, LA), '6:00 AM');
    const groupedLa = groupSlotsByDate([monday], LA);
    const groupedNy = groupSlotsByDate([monday], NY);
    assert.equal(groupedLa[0].slots[0].scheduled_at, monday.scheduled_at);
    assert.equal(groupedNy[0].slots[0].scheduled_at, monday.scheduled_at);
    assert.notEqual(formatTimeInZone(monday.scheduled_at, LA), formatTimeInZone(monday.scheduled_at, NY));
  });

  it('checkout payload is the slot ISO the student selected (same string as scheduled_at)', () => {
    const slot = buildAvailabilitySlots({
      availabilities: [{ weekday: 2, start_time: '14:00:00', end_time: '15:00:00' }],
      durationMinutes: 60,
      coachTimezone: NY,
      daysAhead: 10,
      now: new Date('2026-06-01T12:00:00.000Z'),
      minLeadHours: 0,
    })[0];
    assert.match(slot.scheduled_at, /Z$/);
    const checkoutBody = { scheduled_at: slot.scheduled_at };
    assert.equal(checkoutBody.scheduled_at, slot.scheduled_at);
    assert.equal(localHms(checkoutBody.scheduled_at, NY).slice(11), '14:00:00');
  });
});
