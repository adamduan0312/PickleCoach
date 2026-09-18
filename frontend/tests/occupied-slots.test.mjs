/**
 * Occupied-slot UX: active coach bookings mark generated slots unavailable.
 * Backend intent/confirm checks remain authoritative.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateSlotsWithOccupancy,
  bookingIntervalsOverlap,
  buildAvailabilitySlots,
} from '../src/utils/datetime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('bookingIntervalsOverlap', () => {
  it('treats identical windows as overlapping', () => {
    assert.equal(
      bookingIntervalsOverlap('2026-09-10T19:00:00.000Z', 60, '2026-09-10T19:00:00.000Z', 60),
      true,
    );
  });

  it('allows adjacent (touching) windows', () => {
    assert.equal(
      bookingIntervalsOverlap('2026-09-10T19:00:00.000Z', 60, '2026-09-10T20:00:00.000Z', 60),
      false,
    );
  });
});

describe('annotateSlotsWithOccupancy', () => {
  it('marks a generated slot unavailable when an active booking occupies it', () => {
    const slots = buildAvailabilitySlots({
      availabilities: [{
        weekday: 4, // Thursday
        start_time: '15:00:00',
        end_time: '16:00:00',
        start_date: null,
        end_date: null,
      }],
      durationMinutes: 60,
      coachTimezone: 'America/New_York',
      daysAhead: 14,
      now: new Date('2026-09-01T12:00:00.000Z'),
      minLeadHours: 0,
    });

    const target = slots.find((s) => s.scheduled_at === '2026-09-10T19:00:00.000Z');
    assert.ok(target, 'expected Thu Sep 10 3:00 PM ET slot');

    const annotated = annotateSlotsWithOccupancy(
      slots,
      [{ scheduled_at: '2026-09-10T19:00:00.000Z', duration_minutes: 60 }],
      { durationMinutes: 60 },
    );
    const occupied = annotated.find((s) => s.scheduled_at === target.scheduled_at);
    assert.equal(occupied.occupied, true);
    assert.equal(occupied.available, false);

    const free = annotated.find((s) => s.scheduled_at !== target.scheduled_at);
    if (free) {
      assert.equal(free.occupied, false);
      assert.equal(free.available, true);
    }
  });

  it('marks partial overlaps occupied using booking duration', () => {
    const slots = [{ scheduled_at: '2026-09-10T19:00:00.000Z' }];
    const annotated = annotateSlotsWithOccupancy(
      slots,
      [{ scheduled_at: '2026-09-10T18:30:00.000Z', duration_minutes: 60 }],
      { durationMinutes: 60 },
    );
    assert.equal(annotated[0].occupied, true);
  });
});

describe('occupied-slot wiring contracts', () => {
  it('profile picker disables occupied slots and keeps Booked label', () => {
    const src = readFileSync(
      join(__dirname, '../src/pages/student/CoachPublicProfilePage.jsx'),
      'utf8',
    );
    assert.match(src, /annotateSlotsWithOccupancy/);
    assert.match(src, /occupied_slots/);
    assert.match(src, /Booked/);
    assert.match(src, /disabled=\{isOwnProfile \|\| occupied\}/);
  });
});
