/**
 * Decline reason code enum + request validation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { declineBookingSchema } from '../config/validation.js';
import {
  DECLINE_REASON_CODES,
  getValidDeclineReasonCodes,
  isValidDeclineReasonCode,
} from '../utils/declineReasonCodes.js';

describe('declineReasonCodes', () => {
  it('exports fixed enum values', () => {
    assert.deepEqual(getValidDeclineReasonCodes(), [
      'availability_conflict',
      'sickness',
      'weather',
      'outside_service_area',
      'lesson_not_fit',
      'other',
    ]);
    assert.equal(DECLINE_REASON_CODES.length, 6);
  });

  it('rejects unknown codes', () => {
    assert.equal(isValidDeclineReasonCode('availability_wrong'), false);
    assert.equal(isValidDeclineReasonCode('my_dog_ate_my_calendar'), false);
    assert.equal(isValidDeclineReasonCode('availability_conflict'), true);
  });
});

describe('declineBookingSchema', () => {
  const validMessage = 'Unfortunately this time no longer works for me. Please choose another slot.';

  it('accepts valid decline_reason_code values', () => {
    for (const code of getValidDeclineReasonCodes()) {
      const { error } = declineBookingSchema.validate({
        message_to_student: validMessage,
        decline_reason_code: code,
      });
      assert.equal(error, undefined, `expected ${code} to be valid`);
    }
  });

  it('allows omitting decline_reason_code', () => {
    const { error } = declineBookingSchema.validate({ message_to_student: validMessage });
    assert.equal(error, undefined);
  });

  it('rejects free-form decline_reason_code', () => {
    const { error } = declineBookingSchema.validate({
      message_to_student: validMessage,
      decline_reason_code: 'availability_wrong',
    });
    assert.ok(error);
    assert.match(error.message, /decline_reason_code/);
  });

  it('requires message_to_student at least 3 characters after trim', () => {
    const { error: empty } = declineBookingSchema.validate({ message_to_student: '  ' });
    assert.ok(empty);
    const { error: short } = declineBookingSchema.validate({ message_to_student: 'No' });
    assert.ok(short);
    const { error: ok } = declineBookingSchema.validate({ message_to_student: 'Not available.' });
    assert.equal(ok, undefined);
  });
});
