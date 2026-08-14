/**
 * Pure tests for `services/bookingStateMachine.js` (no DB).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBookingStatusTransition,
  assertBulkBookingStatusTransition,
  BookingTransitionVia,
  canTransitionBookingStatus,
} from '../services/bookingStateMachine.js';
import { Conversation } from '../models/index.js';

describe('bookingStateMachine', () => {
  it('allows pending → confirmed via payment capture webhook', () => {
    const r = canTransitionBookingStatus('pending', 'confirmed', BookingTransitionVia.PAYMENT_CAPTURE_WEBHOOK);
    assert.equal(r.ok, true);
  });

  it('allows pending → confirmed via coach accept capture (sync Stripe succeeded)', () => {
    const r = canTransitionBookingStatus('pending', 'confirmed', BookingTransitionVia.COACH_ACCEPT_CAPTURE);
    assert.equal(r.ok, true);
  });

  it('rejects pending → completed (no such channel)', () => {
    const r = canTransitionBookingStatus('pending', 'completed', BookingTransitionVia.MARK_COMPLETED);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'booking_transition_not_allowed');
  });

  it('allows bulk worker confirmed → awaiting_verification', () => {
    assert.doesNotThrow(() =>
      assertBulkBookingStatusTransition(
        'confirmed',
        'awaiting_verification',
        BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION,
      ),
    );
  });

  it('allows pending → cancelled via payment authorization failure', () => {
    const r = canTransitionBookingStatus(
      'pending',
      'cancelled',
      BookingTransitionVia.PAYMENT_AUTHORIZATION_FAILED,
    );
    assert.equal(r.ok, true);
  });

  it('applyBookingStatusTransition updates Sequelize-like instance and syncs messaging_locked from status', async () => {
    const booking = { status: 'pending', messaging_locked: true, async update(payload) {
      Object.assign(this, payload);
    } };
    await applyBookingStatusTransition(booking, {
      toStatus: 'cancelled',
      via: BookingTransitionVia.COACH_DECLINE,
      patch: { cancelled_by: 'coach' },
    });
    assert.equal(booking.status, 'cancelled');
    assert.equal(booking.cancelled_by, 'coach');
    assert.equal(booking.messaging_locked, true);
  });

  it('pending → confirmed unlocks messaging via state machine patch', async () => {
    const booking = { id: 42, status: 'pending', messaging_locked: true, async update(payload) {
      Object.assign(this, payload);
    } };
    let ensured = false;
    const origFindOne = Conversation.findOne;
    const origCreate = Conversation.create;
    Conversation.findOne = async () => null;
    Conversation.create = async (row) => {
      ensured = true;
      return { id: 1, ...row };
    };
    try {
      await applyBookingStatusTransition(booking, {
        toStatus: 'confirmed',
        via: BookingTransitionVia.COACH_ACCEPT_WITHOUT_PAYMENT,
      });
      assert.equal(booking.messaging_locked, false);
      assert.equal(ensured, true);
    } finally {
      Conversation.findOne = origFindOne;
      Conversation.create = origCreate;
    }
  });

  it('confirmed → awaiting_verification keeps messaging unlocked', async () => {
    const booking = { status: 'confirmed', messaging_locked: false, async update(payload) {
      Object.assign(this, payload);
    } };
    await applyBookingStatusTransition(booking, {
      toStatus: 'awaiting_verification',
      via: BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION,
    });
    assert.equal(booking.messaging_locked, false);
  });

  it('dispute resolve attendance: disputed → coach_no_show', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'coach_no_show',
      BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE,
    );
    assert.equal(r.ok, true);
  });

  it('behavior release: disputed → completed', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING,
    );
    assert.equal(r.ok, true);
  });

  it('catchall other release: disputed → completed', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING,
    );
    assert.equal(r.ok, true);
  });

  it('Stripe terminal release: disputed → completed', () => {
    const r = canTransitionBookingStatus(
      'disputed',
      'completed',
      BookingTransitionVia.STRIPE_DISPUTE_TERMINAL,
    );
    assert.equal(r.ok, true);
  });
});

describe('conversation auto-create (only on → confirmed)', () => {
  async function assertNoConversationOnTransition(booking, toStatus, via, patch = {}) {
    let createCalled = false;
    const origFindOne = Conversation.findOne;
    const origCreate = Conversation.create;
    Conversation.findOne = async () => null;
    Conversation.create = async () => {
      createCalled = true;
      throw new Error('Conversation.create should not run');
    };
    try {
      await applyBookingStatusTransition(booking, { toStatus, via, patch });
      assert.equal(createCalled, false);
    } finally {
      Conversation.findOne = origFindOne;
      Conversation.create = origCreate;
    }
  }

  it('pending → cancelled (coach decline) does not create conversation', async () => {
    await assertNoConversationOnTransition(
      { id: 1, status: 'pending', async update(payload) { Object.assign(this, payload); } },
      'cancelled',
      BookingTransitionVia.COACH_DECLINE,
      { cancelled_by: 'coach' },
    );
  });

  it('pending → cancelled (system expire) does not create conversation', async () => {
    await assertNoConversationOnTransition(
      { id: 2, status: 'pending', async update(payload) { Object.assign(this, payload); } },
      'cancelled',
      BookingTransitionVia.SYSTEM_EXPIRE_PENDING,
      { cancelled_by: 'system' },
    );
  });

  it('pending → cancelled (pre-lesson cancel) does not create conversation', async () => {
    await assertNoConversationOnTransition(
      { id: 3, status: 'pending', async update(payload) { Object.assign(this, payload); } },
      'cancelled',
      BookingTransitionVia.PRE_LESSON_CANCEL,
      { cancelled_by: 'student' },
    );
  });

  it('confirmed → awaiting_verification does not create conversation', async () => {
    await assertNoConversationOnTransition(
      { id: 4, status: 'confirmed', async update(payload) { Object.assign(this, payload); } },
      'awaiting_verification',
      BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION,
    );
  });
});
