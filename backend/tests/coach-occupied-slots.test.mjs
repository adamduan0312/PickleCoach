/**
 * Coach occupied-slot listing for student UI — source/unit contracts.
 * Does not change intent/confirm conflict semantics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COACH_SLOT_OCCUPYING_STATUSES,
  STUDENT_ACTIVE_SCHEDULE_STATUSES,
} from '../services/bookingService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('coach occupied slot statuses', () => {
  it('matches the same active statuses used for schedule conflicts', () => {
    assert.deepEqual([...COACH_SLOT_OCCUPYING_STATUSES], ['pending', 'confirmed', 'awaiting_verification']);
    assert.deepEqual([...COACH_SLOT_OCCUPYING_STATUSES], [...STUDENT_ACTIVE_SCHEDULE_STATUSES]);
  });
});

describe('public availability includes occupied_slots', () => {
  it('attaches occupied_slots only on the public coach availability path', () => {
    const src = readFileSync(join(__dirname, '../controllers/coachController.js'), 'utf8');
    assert.match(src, /listCoachOccupiedBookingIntervals/);
    assert.match(src, /includeOccupiedSlots:\s*true/);
    assert.match(src, /occupied_slots/);
    // Coach self-list should not force occupied payload.
    const myStart = src.indexOf('export const getMyCoachAvailability');
    const myEnd = src.indexOf('export const updateMyAvailability');
    assert.ok(myStart > 0 && myEnd > myStart);
    assert.doesNotMatch(src.slice(myStart, myEnd), /includeOccupiedSlots:\s*true/);
  });

  it('exports listCoachOccupiedBookingIntervals without changing confirm conflict helpers', () => {
    const src = readFileSync(join(__dirname, '../services/bookingService.js'), 'utf8');
    assert.match(src, /export async function listCoachOccupiedBookingIntervals/);
    assert.match(src, /COACH_SLOT_OCCUPYING_STATUSES/);
    assert.match(src, /export const checkBookingAvailability/);
    assert.match(src, /export const checkStudentScheduleConflict/);
  });
});
