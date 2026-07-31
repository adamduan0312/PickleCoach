/**
 * Cross-domain API response DTO contract tests (global cleanup).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDisputeResponse } from '../utils/disputeDto.js';
import { serializePaymentSummary } from '../utils/paymentDto.js';
import {
  serializeReview,
  serializePublicReviewCard,
} from '../utils/reviewDto.js';
import { serializeMessage, serializeConversationDetail } from '../utils/messageDto.js';
import { serializeAvailability } from '../utils/availabilityDto.js';
import { serializeAuditLog } from '../utils/auditLogDto.js';
import { serializeCancellationHistoryItem } from '../utils/bookingDto.js';
import { serializeCoachProfilePublic } from '../utils/userDto.js';

describe('dispute response contract', () => {
  it('participant shape omits Stripe dispute fields and serializes payment safely', () => {
    const out = formatDisputeResponse(
      {
        id: 1,
        booking_id: 10,
        dispute_type_id: 1,
        notes: 'x',
        opened_by: 'student',
        status: 'open',
        decision: null,
        outcome: null,
        refund_cents: null,
        penalize_role: 'none',
        resolution_notes: null,
        resolved_at: null,
        opened_at: '2026-01-01T00:00:00.000Z',
        stripe_dispute_id: 'dp_secret',
        stripe_dispute_status: 'needs_response',
        escalated: true,
        escalated_to: 9,
        escalation_triggered_at: '2026-01-02T00:00:00.000Z',
        admin_id: 1,
        admin: { id: 1, full_name: 'Admin' },
        payment: {
          id: 5,
          booking_id: 10,
          payment_intent_id: 'pi_secret',
          charge_id: 'ch_secret',
          metadata: { flow: 'x' },
          payment_status: 'captured',
          total_charge_to_student: '80.00',
          escrow_status: 'held',
          refund_status: 'none',
          lesson_price: '80.00',
          platform_fee_percent: 8,
          platform_fee_amount: '6.40',
          coach_payout_expected: '73.60',
          coach_id: 2,
          student_id: 3,
          payment_method: 'stripe',
          currency: 'USD',
          refunded_amount: '0.00',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
      { isAdmin: false },
    );
    assert.equal(out.stripe_dispute_id, undefined);
    assert.equal(out.escalated, undefined);
    assert.equal(out.payment.payment_intent_id, undefined);
    assert.equal(out.payment.metadata, undefined);
    assert.equal(out.payment.payment_status, 'captured');
    assert.ok(!('admin_id' in out));
  });

  it('admin shape includes Stripe dispute fields and admin payment fields', () => {
    const out = formatDisputeResponse(
      {
        id: 1,
        booking_id: 10,
        dispute_type_id: 1,
        notes: null,
        opened_by: 'student',
        status: 'open',
        decision: null,
        outcome: null,
        refund_cents: null,
        penalize_role: 'none',
        resolution_notes: null,
        resolved_at: null,
        opened_at: '2026-01-01T00:00:00.000Z',
        stripe_dispute_id: 'dp_1',
        stripe_dispute_status: 'needs_response',
        escalated: false,
        payment: {
          id: 5,
          booking_id: 10,
          payment_intent_id: 'pi_1',
          payment_status: 'captured',
          total_charge_to_student: '80.00',
          escrow_status: 'held',
          refund_status: 'none',
          lesson_price: '80.00',
          platform_fee_percent: 8,
          platform_fee_amount: '6.40',
          coach_payout_expected: '73.60',
          coach_id: 2,
          student_id: 3,
          payment_method: 'stripe',
          currency: 'USD',
          refunded_amount: '0.00',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      },
      { isAdmin: true },
    );
    assert.equal(out.stripe_dispute_id, 'dp_1');
    assert.equal(out.payment.payment_intent_id, 'pi_1');
  });
});

describe('review response contract', () => {
  it('trims nested booking and coach-card reviews to public fields only', () => {
    const dto = serializeReview({
      id: 1,
      booking_id: 9,
      student_id: 2,
      coach_id: 3,
      rating: 5,
      comment: 'Great',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      booking: {
        id: 9,
        scheduled_at: '2026-06-01T10:00:00.000Z',
        status: 'completed',
        lesson_id: 1,
        coach_id: 3,
        primary_student_id: 2,
        idempotency_key: 'secret',
        payout_status: 'none',
      },
      student: { id: 2, full_name: 'Stu', avatar_url: null, email: 's@x.com' },
    });
    assert.equal(dto.booking.idempotency_key, undefined);
    assert.equal(dto.student.email, undefined);
    assert.equal(dto.updated_at, '2026-01-02T00:00:00.000Z');
    assert.deepEqual(Object.keys(dto).sort(), [
      'booking',
      'booking_id',
      'coach_id',
      'comment',
      'created_at',
      'id',
      'rating',
      'student',
      'student_id',
      'updated_at',
    ]);

    const card = serializePublicReviewCard({
      id: 1,
      rating: 5,
      comment: 'Nice',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      booking: { id: 9 },
      student: { id: 2, full_name: 'Stu' },
    });
    assert.equal(card.booking, undefined);
    assert.equal(card.rating, 5);
    assert.deepEqual(Object.keys(card).sort(), [
      'comment',
      'created_at',
      'id',
      'rating',
      'student',
      'updated_at',
    ]);
  });
});

describe('message / availability / audit / cancellation contracts', () => {
  it('message DTO drops unexpected fields', () => {
    const msg = serializeMessage({
      id: 1,
      conversation_id: 2,
      sender_id: 3,
      message_text: 'hi',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      internal_flag: true,
      sender: { id: 3, full_name: 'A', avatar_url: null, email: 'a@x.com' },
    });
    assert.equal(msg.internal_flag, undefined);
    assert.equal(msg.sender.email, undefined);
  });

  it('conversation detail uses lean messaging booking DTO', () => {
    const dto = serializeConversationDetail(
      { id: 1, booking_id: 9, created_at: 'a', updated_at: 'b' },
      {
        booking: {
          id: 9,
          status: 'confirmed',
          lesson_id: 1,
          coach_id: 2,
          primary_student_id: 3,
          scheduled_at: 't',
          duration_minutes: 60,
          price: '50.00',
          court_location_id: 1,
          idempotency_key: 'x',
        },
        messages: [{ id: 1, conversation_id: 1, sender_id: 2, message_text: 'yo', created_at: 't' }],
      },
    );
    assert.equal(dto.booking.idempotency_key, undefined);
    assert.equal(dto.booking.coach_id, undefined);
    assert.equal(dto.booking.duration_minutes, undefined);
    assert.equal(dto.booking.price, undefined);
    assert.equal(dto.booking.court_location_id, undefined);
    assert.equal(dto.booking.lesson_id, 1);
    assert.equal(dto.booking.messaging_locked, false);
    assert.equal(dto.messages[0].message_text, 'yo');
  });

  it('availability DTO does not spread unknown columns', () => {
    const dto = serializeAvailability({
      id: 1,
      coach_id: 2,
      weekday: 1,
      start_date: '2026-01-01',
      end_date: null,
      start_time: '09:00:00',
      end_time: '17:00:00',
      created_at: 't',
      rate_modifier: 99,
    });
    assert.equal(dto.rate_modifier, undefined);
    assert.equal(dto.weekday, 1);
  });

  it('audit log redacts password_hash in state blobs', () => {
    const dto = serializeAuditLog({
      id: 1,
      user_id: 2,
      action: 'login',
      table_name: 'users',
      record_id: 2,
      before_state: null,
      after_state: { id: 2, email: 'a@b.com', password_hash: 'secret' },
      ip_address: '1.1.1.1',
      user_agent: 'x',
      created_at: 't',
    });
    assert.equal(dto.after_state.password_hash, '[REDACTED]');
    assert.equal(dto.after_state.email, 'a@b.com');
  });

  it('cancellation history omits reliability and refund_payment_id', () => {
    const dto = serializeCancellationHistoryItem({
      id: 1,
      booking_id: 2,
      cancelled_by: 'student',
      refund_amount: '10.00',
      penalty_amount: '0.00',
      reason: 'weather',
      reason_notes: null,
      penalty_reason: null,
      cancelled_at: 't',
      affects_reliability: false,
      refund_payment_id: 99,
    });
    assert.equal(dto.affects_reliability, undefined);
    assert.equal(dto.refund_payment_id, undefined);
    assert.equal(dto.reason, 'weather');
  });
});

describe('coach profile mutation DTO', () => {
  it('serializeCoachProfilePublic is used for owner management responses', () => {
    const dto = serializeCoachProfilePublic({
      id: 1,
      user_id: 2,
      headline: 'Pro',
      bio: null,
      experience_years: 1,
      skill_rating: 4,
      rating_system: 'self',
      certifications: null,
      location: 'SF',
      rating_average: 5,
      rating_count: 1,
      coach_commission_percent: 8,
      stripe_account_id: 'acct_x',
      stripe_ready: true,
      stripe_onboarding_completed_at: null,
      deleted_at: null,
      created_at: 't',
      secret_column: 'nope',
    });
    assert.equal(dto.stripe_account_id, 'acct_x');
    assert.equal(dto.secret_column, undefined);
  });
});

describe('payment summary baseline', () => {
  it('hides Stripe fields for participants', () => {
    const dto = serializePaymentSummary(
      {
        id: 1,
        booking_id: 2,
        payment_intent_id: 'pi_x',
        payment_status: 'authorized',
        total_charge_to_student: '50.00',
        escrow_status: 'held',
        refund_status: 'none',
        lesson_price: '50.00',
        platform_fee_percent: 8,
        platform_fee_amount: '4.00',
        coach_payout_expected: '46.00',
        coach_id: 1,
        student_id: 2,
        payment_method: 'stripe',
        currency: 'USD',
        refunded_amount: '0.00',
        created_at: 't',
        updated_at: 't',
      },
      { isAdmin: false },
    );
    assert.equal(dto.payment_intent_id, undefined);
  });
});
