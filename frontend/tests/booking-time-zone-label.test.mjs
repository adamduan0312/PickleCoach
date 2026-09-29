import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { timezoneShortLabel } from '../src/domain/timezones.js';
import { formatBookingWhenInZone, formatListWhenWithZone } from '../src/utils/datetime.js';

describe('timezoneShortLabel', () => {
  it('uses friendly generic names, not abbreviations', () => {
    assert.equal(timezoneShortLabel('America/Los_Angeles'), 'Pacific Time');
    assert.equal(timezoneShortLabel('America/Chicago'), 'Central Time');
    assert.equal(timezoneShortLabel('America/New_York'), 'Eastern Time');
  });

  it('matches Settings wording for Arizona, Hawaii, and UTC', () => {
    assert.equal(timezoneShortLabel('America/Phoenix'), 'Arizona Time');
    assert.equal(timezoneShortLabel('Pacific/Honolulu'), 'Hawaii Time');
    assert.equal(timezoneShortLabel('UTC'), 'UTC');
    assert.equal(timezoneShortLabel('Etc/UTC'), 'UTC');
  });
});

describe('booking time formatting with zone', () => {
  // 2026-09-28 15:00Z = 10:00 AM Chicago = 8:00 AM Los Angeles
  const iso = '2026-09-28T15:00:00.000Z';

  it('each viewer sees their own local time plus zone name', () => {
    const student = formatBookingWhenInZone(iso, 'America/Los_Angeles');
    const coach = formatBookingWhenInZone(iso, 'America/Chicago');
    assert.match(student, /Sep 28, 2026 · 8:00\s?AM Pacific Time$/);
    assert.match(coach, /Sep 28, 2026 · 10:00\s?AM Central Time$/);
  });

  it('list format omits the year but keeps the zone', () => {
    assert.match(formatListWhenWithZone(iso, 'America/Chicago'), /Sep 28 · 10:00\s?AM Central Time$/);
  });

  it('missing time stays a dash', () => {
    assert.equal(formatBookingWhenInZone(null, 'America/Chicago'), '—');
  });
});
