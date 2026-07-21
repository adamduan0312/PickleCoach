/**
 * Marketplace list must only return bookable coaches (DB eligibility).
 * Source-contract tests — no DB.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coachControllerSrc = readFileSync(
  join(__dirname, '../controllers/coachController.js'),
  'utf8',
);

const getCoachesSection = coachControllerSrc.slice(
  coachControllerSrc.indexOf('export const getCoaches'),
  coachControllerSrc.indexOf('export const getCoachById'),
);

describe('GET /api/coaches marketplace bookability', () => {
  it('uses shared marketplace discovery helpers (stripe_ready + court + lesson + availability)', () => {
    assert.match(getCoachesSection, /marketplaceDiscoveryProfileWhereBase/);
    assert.match(getCoachesSection, /marketplaceDiscoveryIncludes/);
  });

  it('does not gate courts only for geo search', () => {
    assert.doesNotMatch(getCoachesSection, /required: isGeoSearch/);
  });
});
