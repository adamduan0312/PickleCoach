import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMON_GROUP,
  buildTimezoneOptions,
  filterTimezoneOptions,
  supportedTimezoneIds,
  timezoneLabel,
} from '../src/domain/timezones.js';

describe('timezoneLabel', () => {
  it('uses friendly regional names, not abbreviations or raw ids', () => {
    assert.equal(timezoneLabel('America/New_York'), 'Eastern Time (US & Canada)');
    assert.equal(timezoneLabel('Asia/Tokyo'), 'Japan');
    assert.equal(timezoneLabel('Asia/Calcutta'), 'India');
  });

  it('derives readable names for uncurated zones', () => {
    assert.equal(timezoneLabel('Pacific/Kiritimati'), 'Kiritimati');
    assert.equal(timezoneLabel('America/Argentina/Cordoba'), 'Cordoba, Argentina');
  });
});

describe('buildTimezoneOptions', () => {
  it('lists the Common U.S. zones first, in order', () => {
    const options = buildTimezoneOptions({ ids: [] });
    const common = options.filter((o) => o.group === COMMON_GROUP).map((o) => o.label);
    assert.deepEqual(common, [
      'Eastern Time (US & Canada)',
      'Central Time (US & Canada)',
      'Mountain Time (US & Canada)',
      'Pacific Time (US & Canada)',
      'Alaska Time',
      'Hawaii Time',
      'Arizona',
    ]);
    assert.equal(options[0].value, 'America/New_York');
  });

  it('includes all engine-supported zones without duplicating aliases', () => {
    const ids = supportedTimezoneIds();
    const options = buildTimezoneOptions({ ids });
    const values = options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    assert.ok(options.length >= ids.length * 0.9, 'worldwide list should be present');
    assert.ok(values.includes('Asia/Kolkata'));
    assert.equal(values.includes('Asia/Calcutta'), false);
  });

  it('keeps an unknown saved zone selectable', () => {
    const options = buildTimezoneOptions({ ids: [], currentValue: 'Pacific/Kiritimati' });
    assert.ok(options.some((o) => o.value === 'Pacific/Kiritimati'));
  });
});

describe('filterTimezoneOptions', () => {
  const options = buildTimezoneOptions({ ids: supportedTimezoneIds() });

  it('finds Tokyo by city name', () => {
    const results = filterTimezoneOptions(options, 'tokyo');
    assert.ok(results.some((o) => o.value === 'Asia/Tokyo'));
  });

  it('matches city names hidden in the id (New York → Eastern)', () => {
    const results = filterTimezoneOptions(options, 'new york');
    assert.ok(results.some((o) => o.value === 'America/New_York'));
  });

  it('ignores accents and returns everything for an empty query', () => {
    assert.ok(filterTimezoneOptions(options, 'cancun').some((o) => o.value === 'America/Cancun'));
    assert.equal(filterTimezoneOptions(options, '  ').length, options.length);
  });
});
