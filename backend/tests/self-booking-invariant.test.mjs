/**
 * Self-booking must be rejected at intent create and confirm (identity, not UI).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../services/bookingIntentService.js'), 'utf8');

describe('self-booking invariant (booking intents)', () => {
  it('rejects coach_id === studentId during intent validation', () => {
    assert.match(src, /lesson\.coach_id === studentId/);
    assert.match(src, /You cannot book your own lesson/);
  });

  it('re-checks coach_id === studentId on confirm before creating the booking', () => {
    const confirmIdx = src.indexOf('export async function confirmBookingFromPaymentIntent');
    assert.ok(confirmIdx > 0);
    const confirmBody = src.slice(confirmIdx, confirmIdx + 3500);
    assert.match(confirmBody, /lesson\.coach_id === studentId/);
    assert.match(confirmBody, /cannot_book_self|You cannot book your own lesson/);
  });
});
