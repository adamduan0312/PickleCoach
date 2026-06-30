/**
 * Cancellation API response shape — timing vs money vs reliability.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCancellationApiPayload,
  cancellationTypeFromIsLate,
} from '../utils/cancellationResponse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('cancellationTypeFromIsLate', () => {
  it('maps boolean late flag to late | non_late', () => {
    assert.equal(cancellationTypeFromIsLate(true), 'late');
    assert.equal(cancellationTypeFromIsLate(false), 'non_late');
  });
});

describe('buildCancellationApiPayload', () => {
  const baseRow = {
    id: 10,
    booking_id: 1,
    cancelled_by: 'student',
    reason: 'forgot',
    reason_notes: 'test',
    refund_amount: '59.40',
    penalty_amount: '59.40',
    penalty_reason: 'Late cancellation',
    affects_reliability: true,
    cancelled_at: '2026-06-24T12:00:00.000Z',
  };

  it('student late captured: late type, financial penalty, reliability flag', () => {
    const payload = buildCancellationApiPayload(baseRow, { isLateCancel: true });
    assert.equal(payload.cancellation_type, 'late');
    assert.equal(payload.affects_reliability, true);
    assert.equal(payload.penalty_reason, 'Late cancellation');
    assert.equal(payload.refund_amount, '59.40');
    assert.equal(payload.penalty_amount, '59.40');
  });

  it('coach late cancel: late type, full refund, coach penalty_reason unchanged', () => {
    const payload = buildCancellationApiPayload(
      {
        ...baseRow,
        cancelled_by: 'coach',
        refund_amount: '118.80',
        penalty_amount: '0.00',
        penalty_reason: 'Coach cancellation',
      },
      { isLateCancel: true },
    );
    assert.equal(payload.cancellation_type, 'late');
    assert.equal(payload.penalty_reason, 'Coach cancellation');
    assert.equal(payload.penalty_amount, '0.00');
  });

  it('student non-late excused: non_late, no reliability impact', () => {
    const payload = buildCancellationApiPayload(
      {
        ...baseRow,
        reason: 'sickness',
        refund_amount: '118.80',
        penalty_amount: '0.00',
        penalty_reason: null,
        affects_reliability: false,
      },
      { isLateCancel: false },
    );
    assert.equal(payload.cancellation_type, 'non_late');
    assert.equal(payload.affects_reliability, false);
    assert.equal(payload.penalty_reason, null);
  });

  it('late uncaptured void: late type with zero financials', () => {
    const payload = buildCancellationApiPayload(
      {
        ...baseRow,
        refund_amount: '0.00',
        penalty_amount: '0.00',
        penalty_reason: null,
      },
      { isLateCancel: true },
    );
    assert.equal(payload.cancellation_type, 'late');
    assert.equal(payload.refund_amount, '0.00');
    assert.equal(payload.penalty_amount, '0.00');
  });

  it('does not merge timing into penalty_reason', () => {
    const payload = buildCancellationApiPayload(baseRow, { isLateCancel: true });
    assert.notEqual(payload.penalty_reason, 'Coach late cancellation');
    assert.equal(payload.cancellation_type, 'late');
  });
});

describe('cancelBooking response wiring', () => {
  it('uses buildCancellationApiPayload instead of sanitizeResponse for cancel', () => {
    const src = readFileSync(join(__dirname, '../controllers/bookingController.js'), 'utf8');
    const cancelSection = src.slice(src.indexOf('export const cancelBooking'), src.indexOf('export const adminPreLessonCancelBooking'));
    assert.match(cancelSection, /buildCancellationApiPayload\(cancellationHistory/);
    assert.doesNotMatch(cancelSection, /sanitizeResponse\(cancellationHistory\)/);
  });
});
