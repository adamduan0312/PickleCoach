import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDateInZone,
  formatListDateInZone,
  formatListWhenInZone,
} from '../src/utils/datetime.js';

const tz = 'America/New_York';

describe('list date formatting', () => {
  it('formatListDateInZone omits the year', () => {
    const iso = '2026-09-01T13:49:00.000Z';
    assert.match(formatListDateInZone(iso, tz), /Sep 1/);
    assert.doesNotMatch(formatListDateInZone(iso, tz), /2026/);
    assert.match(formatDateInZone(iso, tz), /2026/);
  });

  it('formatListWhenInZone combines short date and time', () => {
    const iso = '2026-09-01T13:49:00.000Z';
    const label = formatListWhenInZone(iso, tz);
    assert.match(label, /Sep 1/);
    assert.match(label, /9:49/);
    assert.doesNotMatch(label, /2026/);
  });
});
