/**
 * Decline notification payload includes enum + human message for student display.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildBookingDeclinedNotificationContent } from '../services/notificationService.js';
import { DECLINE_REASON_LABELS } from '../utils/declineReasonCodes.js';

describe('buildBookingDeclinedNotificationContent', () => {
  it('includes reason label and coach message', () => {
    const content = buildBookingDeclinedNotificationContent({
      decline_reason_code: 'weather',
      message_to_student: 'Thunderstorms are expected during lesson time.',
    });
    assert.equal(content.headline, 'Coach declined your booking.');
    assert.equal(content.reason_line, 'Reason: Weather');
    assert.equal(content.message_to_student, 'Thunderstorms are expected during lesson time.');
    assert.equal(DECLINE_REASON_LABELS.weather, 'Weather');
    assert.match(content.summary, /Coach declined your booking/);
    assert.match(content.summary, /Reason: Weather/);
    assert.match(content.summary, /Message:/);
    assert.match(content.summary, /Thunderstorms are expected during lesson time/);
  });

  it('shows message when decline_reason_code omitted', () => {
    const content = buildBookingDeclinedNotificationContent({
      message_to_student: 'Please choose another slot.',
    });
    assert.equal(content.headline, 'Coach declined your booking.');
    assert.equal(content.reason_line, null);
    assert.equal(content.message_to_student, 'Please choose another slot.');
    assert.match(content.summary, /Please choose another slot/);
  });

  it('shows reason when message omitted (edge case)', () => {
    const content = buildBookingDeclinedNotificationContent({
      decline_reason_code: 'availability_conflict',
    });
    assert.equal(content.reason_line, 'Reason: Availability conflict');
    assert.equal(content.message_to_student, null);
  });
});
