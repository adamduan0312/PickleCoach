import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDisputeResponse } from '../controllers/disputeController.js';

/**
 * formatDisputeResponse is a pure transform applied to every dispute the API
 * returns. These tests pin the public response shape so future changes don't
 * accidentally regress what callers see for `outcome`, `refund_amount`, and
 * the admin field projection.
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
  admin: { id: 10, full_name: 'Admin User' },
  resolved_at: '2026-01-02T00:00:00.000Z',
  opened_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
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
  // refund_cents must not leak through; refund_amount is the public surface.
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
