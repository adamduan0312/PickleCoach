import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AVAILABILITY_MAX_MONTHS_AHEAD,
  addMonthsYmd,
  availabilityApiErrors,
  availabilityBookingOpensOn,
  availabilityRowLabel,
  availabilityVisibilityNote,
  formatTimeOfDay12h,
  latestAvailabilityDate,
  todayInZone,
} from '../src/domain/availability.js';
import { AVAILABILITY_LOOKAHEAD_DAYS } from '../src/utils/datetime.js';
import * as backend from '../../backend/utils/availabilityRules.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// 2026-09-30 is a Wednesday.
const today = '2026-09-30';

test('ceiling and month math match the backend', () => {
  assert.equal(AVAILABILITY_MAX_MONTHS_AHEAD, backend.AVAILABILITY_MAX_MONTHS_AHEAD);
  for (const [ymd, n] of [['2026-01-31', 1], ['2028-02-29', 12], ['2026-09-30', 24], ['2026-11-15', 2]]) {
    assert.equal(addMonthsYmd(ymd, n), backend.addMonthsYmd(ymd, n), `${ymd} + ${n}`);
  }
  assert.equal(latestAvailabilityDate(today), '2028-09-30');
  assert.equal(formatTimeOfDay12h('16:00:00'), backend.formatTimeOfDay12h('16:00:00'));
});

test('booking visibility: windows within the 60-day booking range are bookable now', () => {
  assert.equal(AVAILABILITY_LOOKAHEAD_DAYS, 60);
  assert.deepEqual(availabilityBookingOpensOn({ weekday: 1, start_date: null, end_date: null }, today), { status: 'visible' });
  // First Monday on/after Nov 23 is Nov 23 = today + 54 days → visible.
  assert.deepEqual(availabilityBookingOpensOn({ weekday: 1, start_date: '2026-11-23', end_date: null }, today), { status: 'visible' });
  assert.equal(availabilityVisibilityNote({ weekday: 1, start_date: null, end_date: null }, today), null);
});

test('booking visibility: windows starting beyond 60 days explain when students can book', () => {
  const v = availabilityBookingOpensOn({ weekday: 1, start_date: '2027-03-01', end_date: null }, today);
  assert.deepEqual(v, { status: 'later', opensOn: '2027-01-01', firstDate: '2027-03-01' });
  assert.equal(
    availabilityVisibilityNote({ weekday: 1, start_date: '2027-03-01', end_date: null }, today),
    'Students can book these times starting Jan 1, 2027 (bookings open 60 days ahead; first lesson day Mar 1, 2027).',
  );
  // Start date on a Tuesday → first Monday is the following week.
  assert.equal(availabilityBookingOpensOn({ weekday: 1, start_date: '2027-03-02', end_date: null }, today).firstDate, '2027-03-08');
});

test('booking visibility: a range with no matching weekday warns', () => {
  // Thu Oct 1 – Sat Oct 3 contains no Monday.
  assert.deepEqual(availabilityBookingOpensOn({ weekday: 1, start_date: '2026-10-01', end_date: '2026-10-03' }, today), { status: 'none' });
  assert.match(availabilityVisibilityNote({ weekday: 1, start_date: '2026-10-01', end_date: '2026-10-03' }, today), /doesn’t include a Monday/);
});

test('todayInZone uses the coach’s calendar day', () => {
  const instant = new Date('2026-10-01T02:00:00Z');
  assert.equal(todayInZone('America/New_York', instant), '2026-09-30');
  assert.equal(todayInZone('UTC', instant), '2026-10-01');
});

test('API errors: field details land on fields; overlap messages stay general', () => {
  assert.deepEqual(
    availabilityApiErrors({ message: 'Validation failed', details: [{ field: 'end_date', message: 'End date … has already passed.' }] }),
    { fields: { end_date: 'End date … has already passed.' }, general: null },
  );
  const overlap = 'This overlaps your Monday 9:00 AM–12:00 PM window. Edit that window to 9:00 AM–4:00 PM, or add 12:00 PM–4:00 PM instead.';
  assert.deepEqual(availabilityApiErrors({ message: overlap }), { fields: {}, general: overlap });
});

test('rows read as 12-hour times with a date summary', () => {
  assert.equal(availabilityRowLabel({ start_time: '09:00:00', end_time: '12:00:00' }), '9:00 AM – 12:00 PM · every week');
  assert.equal(
    availabilityRowLabel({ start_time: '13:00:00', end_time: '16:30:00', start_date: '2026-10-01', end_date: '2026-12-31' }),
    '1:00 PM – 4:30 PM · Oct 1, 2026 – Dec 31, 2026',
  );
});

test('availability page: inline edit + field errors + date limits + visibility note, no auto-merge', () => {
  const src = read('../src/pages/coach/CoachAvailabilityPage.jsx');
  assert.match(src, /coachesApi\.updateAvailability\(editingId, body\)/);
  assert.match(src, /coachesApi\.createAvailability\(body\)/);
  // Edit replaces the row in place; other rows' Edit is blocked while one is open.
  assert.match(src, /if \(editingId === row\.id\) \{\s*return \(\s*<form/);
  assert.match(src, /onClick=\{\(\) => \(editingId \? showBlockedNotice\(\) : startEdit\(row\)\)\}/);
  assert.match(src, /useUnsavedChangesGuard\(isEditDirty\)/);
  assert.match(src, /const \{ fields, general \} = availabilityApiErrors\(ex\);/);
  assert.match(src, /error=\{addErrors\.weekday\}/);
  for (const f of ['start_time', 'end_time', 'start_date', 'end_date']) {
    assert.match(src, new RegExp(`error=\\{errors\\.${f}\\}`), f);
  }
  assert.match(src, /max=\{latestDate\}/);
  assert.match(src, /min=\{form\.start_date && form\.start_date > today \? form\.start_date : today\}/);
  assert.match(src, /availabilityVisibilityNote\(row, today\)/);
  assert.match(src, /For late sessions past midnight, add a window on the next day\./);
  assert.doesNotMatch(src, /merge/i);
});
