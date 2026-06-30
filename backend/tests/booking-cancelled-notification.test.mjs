/**
 * Cancellation notification copy includes cancelled_by, reason, and optional notes/refund.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBookingCancelledNotificationContent,
  CANCELLATION_REASON_LABELS,
} from '../services/notificationService.js';

describe('buildBookingCancelledNotificationContent', () => {
  it('coach cancel with weather reason', () => {
    const content = buildBookingCancelledNotificationContent({
      cancelled_by: 'coach',
      reason: 'weather',
    });
    assert.match(content.headline, /cancelled by the coach/i);
    assert.equal(content.reason_line, 'Reason: Weather');
    assert.equal(CANCELLATION_REASON_LABELS.weather, 'Weather');
  });

  it('student cancel with emergency reason and notes', () => {
    const content = buildBookingCancelledNotificationContent({
      cancelled_by: 'student',
      reason: 'emergency',
      reason_notes: 'Family emergency',
    });
    assert.match(content.headline, /cancelled by the student/i);
    assert.equal(content.reason_line, 'Reason: Emergency');
    assert.equal(content.reason_notes, 'Family emergency');
    assert.match(content.summary, /Family emergency/);
  });

  it('includes refund line when refund_amount present', () => {
    const content = buildBookingCancelledNotificationContent({
      cancelled_by: 'coach',
      reason: 'schedule_conflict',
      refund_amount: 45.5,
      refund_status: 'pending_stripe_execution',
    });
    assert.match(content.refund_line, /\$45\.50/);
    assert.match(content.refund_line, /processing/);
  });

  it('travel_delay is a penalized reason label', () => {
    const content = buildBookingCancelledNotificationContent({
      cancelled_by: 'student',
      reason: 'travel_delay',
    });
    assert.equal(content.reason_line, 'Reason: Travel delay');
  });
});
