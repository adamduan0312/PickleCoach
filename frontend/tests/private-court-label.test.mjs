import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { privateCourtArea, teachingLocationLabel, discoverTeachingPlaceLabel } from '../src/utils/format.js';

describe('private court labels', () => {
  it('redacted private court shows "Private location · City, ST" (no street, no ZIP)', () => {
    const redacted = { name: 'Smith Backyard', is_private: true, address_line1: null, city: null, state: null, area: 'Weston, FL 33327' };
    assert.equal(privateCourtArea(redacted), 'Weston, FL');
    assert.equal(teachingLocationLabel(redacted), 'Private location · Weston, FL');
    assert.equal(discoverTeachingPlaceLabel({ courts: [redacted] }), 'Private location · Weston, FL');
  });

  it('falls back to "Private location" without an area; public courts unchanged', () => {
    assert.equal(teachingLocationLabel({ is_private: true }), 'Private location');
    assert.equal(teachingLocationLabel({ is_private: false, area: 'Weston, FL 33327' }), 'Weston, FL 33327');
  });
});
