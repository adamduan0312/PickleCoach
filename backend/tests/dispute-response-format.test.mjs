import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDisputeResponse,
  serializeBookingForDisputes,
  serializeDisputeTypeSummary,
  serializeResolutionAction,
  serializeResolvedByAdmin,
} from '../utils/disputeDto.js';

/**
 * formatDisputeResponse is a pure transform applied to every dispute the API
 * returns. These tests pin the public response shape so future changes don't
 * accidentally regress what callers see for `outcome`, `refund_amount`, nested
 * DTOs, and the admin field projection.
 */

const baseDispute = (overrides = {}) => ({
  id: 1,
  booking_id: 1,
  dispute_type_id: 1,
  notes: null,
  opened_by: 'student',
  status: 'resolved',
  decision: 'upheld',
  outcome: null,
  refund_cents: null,
  penalize_role: 'none',
  resolution_notes: null,
  admin_id: 10,
  admin: { id: 10, full_name: 'Admin User', email: 'admin@example.com' },
  resolved_at: '2026-01-02T00:00:00.000Z',
  opened_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const fullBooking = {
  id: 352,
  lesson_id: 61,
  coach_id: 77,
  primary_student_id: 2,
  scheduled_at: '2026-06-01T10:00:00.000Z',
  duration_minutes: 60,
  price: '80.00',
  status: 'disputed',
  court_location_id: 75,
  messaging_locked: true,
  payout_status: 'none',
  attendance_finalized: false,
  cancelled_by: null,
  idempotency_key: 'idem-xyz',
  created_at: '2026-05-28T08:00:00.000Z',
  updated_at: '2026-05-28T08:00:00.000Z',
};

const fullDisputeType = {
  id: 1,
  code: 'coach_no_show_claim',
  name: 'Coach no-show (claim)',
  description: 'Student claims coach did not attend',
  default_escalation_hours: 48,
  severity: 'high',
  affects_reliability_score: true,
  created_at: '2025-01-01T00:00:00.000Z',
};

const fullResolutionAction = {
  id: 2,
  code: 'approved_refund',
  name: 'Approved refund',
  description: 'Full refund to student',
  affects_reliability_score: false,
  requires_payout_adjustment: true,
  created_at: '2025-01-01T00:00:00.000Z',
};

test('serializeBookingForDisputes trims internal booking fields', () => {
  const dto = serializeBookingForDisputes(fullBooking);
  assert.equal(dto.id, 352);
  assert.equal(dto.lesson_id, 61);
  assert.equal(dto.status, 'disputed');
  assert.equal(dto.messaging_locked, true);
  assert.equal(dto.payout_status, undefined);
  assert.equal(dto.idempotency_key, undefined);
  assert.equal(dto.created_at, undefined);
});

test('serializeDisputeTypeSummary exposes id, code, name, description only', () => {
  const dto = serializeDisputeTypeSummary(fullDisputeType);
  assert.deepEqual(dto, {
    id: 1,
    code: 'coach_no_show_claim',
    name: 'Coach no-show (claim)',
    description: 'Student claims coach did not attend',
  });
  assert.equal(dto.default_escalation_hours, undefined);
  assert.equal(dto.severity, undefined);
  assert.equal(dto.created_at, undefined);
});

test('serializeResolutionAction exposes id, code, name, description only', () => {
  const dto = serializeResolutionAction(fullResolutionAction);
  assert.deepEqual(dto, {
    id: 2,
    code: 'approved_refund',
    name: 'Approved refund',
    description: 'Full refund to student',
  });
  assert.equal(dto.requires_payout_adjustment, undefined);
  assert.equal(dto.created_at, undefined);
});

test('serializeResolvedByAdmin exposes id and full_name only', () => {
  const dto = serializeResolvedByAdmin({
    id: 5,
    full_name: 'Admin User',
    email: 'admin@example.com',
    password_hash: 'secret',
  });
  assert.deepEqual(dto, { id: 5, full_name: 'Admin User' });
});

test('formatDisputeResponse: partial refund cents are surfaced as decimal dollar string', () => {
  const out = formatDisputeResponse(
    baseDispute({
      outcome: 'coach_no_show',
      refund_cents: 1234,
    }),
  );

  assert.equal(out.refund_amount, '12.34');
  assert.equal(out.outcome, 'coach_no_show');
  assert.ok(!('refund_cents' in out), 'refund_cents should be stripped from public JSON');
});

test('formatDisputeResponse: zero or sub-dollar cents pad correctly', () => {
  const out5 = formatDisputeResponse(baseDispute({ refund_cents: 5 }));
  assert.equal(out5.refund_amount, '0.05');

  const out500 = formatDisputeResponse(baseDispute({ refund_cents: 500 }));
  assert.equal(out500.refund_amount, '5.00');
});

test('formatDisputeResponse: null refund_cents yields null refund_amount', () => {
  const out = formatDisputeResponse(baseDispute({ refund_cents: null }));
  assert.equal(out.refund_amount, null);
});

test('formatDisputeResponse: behavior disputes carry null outcome through unchanged', () => {
  const out = formatDisputeResponse(
    baseDispute({
      dispute_type_id: 3,
      decision: 'upheld',
      penalize_role: 'coach',
      outcome: null,
      refund_cents: null,
    }),
  );

  assert.equal(out.outcome, null);
  assert.equal(out.refund_amount, null);
  assert.equal(out.penalize_role, 'coach');
});

test('formatDisputeResponse: admin / admin_id stripped, resolved_by_admin exposed', () => {
  const out = formatDisputeResponse(
    baseDispute({ admin: { id: 10, full_name: 'Admin User' }, admin_id: 10 }),
  );

  assert.ok(!('admin' in out), 'raw admin association should be stripped');
  assert.ok(!('admin_id' in out), 'admin_id should be stripped from public JSON');
  assert.deepEqual(out.resolved_by_admin, { id: 10, full_name: 'Admin User' });
});

test('formatDisputeResponse: unresolved dispute exposes nulls for resolved_by_admin', () => {
  const out = formatDisputeResponse(
    baseDispute({
      status: 'open',
      decision: null,
      admin: null,
      admin_id: null,
      resolved_at: null,
      refund_cents: null,
      outcome: null,
    }),
  );

  assert.equal(out.resolved_by_admin, null);
  assert.equal(out.refund_amount, null);
  assert.equal(out.outcome, null);
});

test('formatDisputeResponse: nested booking, disputeType, resolutionAction are trimmed DTOs', () => {
  const out = formatDisputeResponse(
    baseDispute({
      booking: fullBooking,
      disputeType: fullDisputeType,
      resolutionAction: fullResolutionAction,
    }),
  );

  assert.equal(out.booking.id, 352);
  assert.equal(out.booking.messaging_locked, true);
  assert.equal(out.booking.idempotency_key, undefined);
  assert.equal(out.disputeType.code, 'coach_no_show_claim');
  assert.equal(out.disputeType.severity, undefined);
  assert.equal(out.resolutionAction.code, 'approved_refund');
  assert.equal(out.resolutionAction.requires_payout_adjustment, undefined);
});

test('formatDisputeResponse: participant omits stripe dispute fields; admin includes them', () => {
  const raw = baseDispute({
    stripe_dispute_id: 'dp_1',
    stripe_dispute_status: 'warning_needs_response',
    escalated: true,
  });
  const participant = formatDisputeResponse(raw, { isAdmin: false });
  assert.equal(participant.stripe_dispute_id, undefined);
  assert.equal(participant.escalated, undefined);

  const admin = formatDisputeResponse(raw, { isAdmin: true });
  assert.equal(admin.stripe_dispute_id, 'dp_1');
  assert.equal(admin.escalated, true);
});

test('formatDisputeResponse: payment uses payment DTO (never raw Stripe ids for participants)', () => {
  const out = formatDisputeResponse(
    baseDispute({
      payment: {
        id: 9,
        booking_id: 1,
        payment_intent_id: 'pi_secret',
        charge_id: 'ch_secret',
        metadata: { x: 1 },
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
    }),
    { isAdmin: false },
  );
  assert.equal(out.payment.payment_status, 'captured');
  assert.equal(out.payment.payment_intent_id, undefined);
  assert.equal(out.payment.metadata, undefined);
});

test('formatDisputeResponse: null nested associations serialize to null', () => {
  const out = formatDisputeResponse(
    baseDispute({
      status: 'open',
      resolutionAction: null,
      disputeType: fullDisputeType,
      booking: fullBooking,
    }),
  );

  assert.equal(out.resolutionAction, null);
  assert.equal(out.disputeType.code, 'coach_no_show_claim');
});

test('formatDisputeResponse: passes through null/undefined input', () => {
  assert.equal(formatDisputeResponse(null), null);
  assert.equal(formatDisputeResponse(undefined), undefined);
});

test('formatDisputeResponse: works with sequelize-like instance via toJSON()', () => {
  const fake = {
    toJSON() {
      return baseDispute({ refund_cents: 9900, outcome: 'student_no_show' });
    },
  };
  const out = formatDisputeResponse(fake);

  assert.equal(out.refund_amount, '99.00');
  assert.equal(out.outcome, 'student_no_show');
});
