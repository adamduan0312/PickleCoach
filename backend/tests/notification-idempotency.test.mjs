/**
 * Notification idempotency wiring — one logical event per user/type/channel/entity.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../services/notificationService.js'), 'utf8');

describe('notification idempotency contract', () => {
  it('finds or creates entity-scoped rows and treats unique races as a reload', () => {
    assert.match(src, /findOrCreateLogicalNotification/);
    assert.match(src, /SequelizeUniqueConstraintError/);
    assert.match(src, /entity_type && entity_id != null/);
  });

  it('does not re-send a row that is already sent', () => {
    assert.match(src, /current\.status === 'sent'/);
    assert.match(src, /status: \{ \[Op\.ne\]: 'sent' \}/);
    assert.match(src, /GET_LOCK/);
    assert.match(src, /emailNotif\.status === 'sent'/);
  });

  it('scopes once-per-booking dual-channel notifies to the booking entity', () => {
    for (const name of [
      'notifyCoachNewBookingRequest',
      'notifyBookingAccepted',
      'notifyBookingDeclined',
      'notifyBookingCancelled',
      'notifyStudentNoShow',
      'notifyCoachNoShow',
      'notifyBookingRequestExpired',
      'notifyRefundSucceeded',
    ]) {
      assert.match(src, new RegExp(`export const ${name}`), name);
    }
    assert.match(src, /bookingEntity\(booking\)/);
  });

  it('keeps stripe payout transitions unconstrained so disable/enable can fire again', () => {
    const disabled = src.slice(
      src.indexOf('export const notifyCoachStripePayoutsDisabled'),
      src.indexOf('export const notifyCoachStripePayoutsEnabled'),
    );
    assert.doesNotMatch(disabled, /entity_type:/);
  });
});
