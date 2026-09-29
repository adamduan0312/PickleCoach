import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bookingApiErrorCopy } from '../src/domain/bookingErrors.js';

const err = (code, payload = {}) => ({ code, payload: { code, ...payload } });

describe('bookingApiErrorCopy — slot conflicts', () => {
  it('slot taken after authorization: says another student booked it and the authorization was cancelled', () => {
    const copy = bookingApiErrorCopy(err('slot_no_longer_available', { authorization_cancelled: true }));
    assert.equal(copy.kind, 'slot_taken');
    assert.equal(copy.title, 'This time slot is no longer available.');
    assert.equal(
      copy.body,
      'Another student booked this time while you were completing checkout. Your payment authorization was cancelled. Please choose another available time.',
    );
  });

  it('slot taken after authorization but cancel failed: reassures no charge', () => {
    const copy = bookingApiErrorCopy(err('slot_no_longer_available', { authorization_cancelled: false }));
    assert.match(copy.body, /while you were completing checkout/);
    assert.match(copy.body, /You were not charged/);
  });

  it('slot taken before authorization: no payment wording', () => {
    const copy = bookingApiErrorCopy(err('slot_no_longer_available'));
    assert.equal(copy.body, 'Another student has already booked this time. Please choose another available time.');
    assert.doesNotMatch(copy.body, /authorization|charged/);
  });

  it('coach availability changed is not blamed on another student', () => {
    const copy = bookingApiErrorCopy(err('slot_outside_coach_availability'));
    assert.equal(copy.kind, 'slot_taken');
    assert.match(copy.body, /coach's availability has changed/);
    assert.doesNotMatch(copy.body, /Another student/);
  });

  it('student overlap at confirm mentions the cancelled authorization', () => {
    const copy = bookingApiErrorCopy(err('student_schedule_conflict', { authorization_cancelled: true }));
    assert.equal(copy.kind, 'student_schedule');
    assert.match(copy.body, /Your payment authorization was cancelled/);
  });

  it('unrelated errors (e.g. card declined) are not treated as slot conflicts', () => {
    assert.equal(bookingApiErrorCopy(err('card_declined')), null);
    assert.equal(bookingApiErrorCopy(new Error('Your card was declined.')), null);
  });
});
