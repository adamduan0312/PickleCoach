/**
 * Decline notification payload includes enum + human message for student display.
 * Bell summary stays one sentence; details are structured fields.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBookingDeclinedNotificationContent } from '../notifications/payloadBuilders.js';
import { DECLINE_REASON_LABELS } from '../utils/declineReasonCodes.js';

describe('buildBookingDeclinedNotificationContent', () => {
  it('includes reason label and coach message as structured fields', () => {
    const content = buildBookingDeclinedNotificationContent({
      decline_reason_code: 'weather',
      message_to_student: 'Thunderstorms are expected during lesson time.',
    });
    assert.equal(content.headline, 'Coach declined your booking.');
    assert.equal(content.summary, 'Coach declined your booking.');
    assert.equal(content.reason_line, 'Reason: Weather');
    assert.equal(content.message_to_student, 'Thunderstorms are expected during lesson time.');
    assert.equal(DECLINE_REASON_LABELS.weather, 'Weather');
    assert.doesNotMatch(content.summary, /Reason:/);
    assert.doesNotMatch(content.summary, /Thunderstorms/);
  });

  it('shows message when decline_reason_code omitted', () => {
    const content = buildBookingDeclinedNotificationContent({
      message_to_student: 'Please choose another slot.',
    });
    assert.equal(content.headline, 'Coach declined your booking.');
    assert.equal(content.summary, content.headline);
    assert.equal(content.reason_line, null);
    assert.equal(content.message_to_student, 'Please choose another slot.');
  });

  it('shows reason when message omitted (edge case)', () => {
    const content = buildBookingDeclinedNotificationContent({
      decline_reason_code: 'availability_conflict',
    });
    assert.equal(content.reason_line, 'Reason: Availability conflict');
    assert.equal(content.message_to_student, null);
    assert.equal(content.summary, content.headline);
  });
});
