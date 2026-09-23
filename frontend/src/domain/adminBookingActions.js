/**
 * Soft eligibility for admin booking money / attendance actions.
 * Mirrors backend cancel / adminRefundBooking / admin mark-no-show guards for UX;
 * API remains authoritative.
 */

import {
  hasOpenIssueReport,
  isFinancialReviewWindowOpen,
  isStudentPaymentRefunded,
} from './bookingStatus.js';

const PRE_LESSON_CANCEL_STATUSES = new Set(['pending', 'confirmed']);

/** Mirror backend ADMIN_MARK_NO_SHOW_SOURCE_STATUSES */
export const ADMIN_NO_SHOW_SOURCE_STATUSES = [
  'confirmed',
  'awaiting_verification',
  'student_no_show',
  'coach_no_show',
];

export const ADMIN_REFUND_REASONS = [
  { value: 'requested_by_customer', label: 'Requested by customer' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'fraudulent', label: 'Fraudulent' },
];

function lessonEndMs(booking) {
  const start = new Date(booking?.scheduled_at).getTime();
  if (!Number.isFinite(start)) return null;
  const durationMin = Number(booking?.duration_minutes) || 0;
  return start + durationMin * 60 * 1000;
}

export function lessonHasEnded(booking, now = Date.now()) {
  const end = lessonEndMs(booking);
  if (end == null) return false;
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  return t >= end;
}

/**
 * Remaining refundable dollars from payment DTO (soft). Backend/Stripe are authoritative.
 */
export function refundableRemainingAmount(payment) {
  if (!payment) return null;
  const captured = Number(payment.total_charge_to_student);
  if (!Number.isFinite(captured) || captured <= 0) return null;
  const refunded = Number(payment.refunded_amount);
  const already = Number.isFinite(refunded) && refunded > 0 ? refunded : 0;
  return Math.max(0, Number((captured - already).toFixed(2)));
}

/**
 * Admin pre-lesson cancel — same status gate as BE (`pending`/`confirmed`) plus
 * lesson start (`assertPreLessonCancelAllowed`).
 */
export function canAdminCancelBooking(booking, now = Date.now()) {
  if (!booking || !PRE_LESSON_CANCEL_STATUSES.has(booking.status)) return false;
  const start = new Date(booking.scheduled_at).getTime();
  if (!Number.isFinite(start)) return false;
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  return start > t;
}

export function adminCancelBlockedMessage(booking, now = Date.now()) {
  if (!booking) return 'Cancellation is not available.';
  if (booking.status === 'disputed' || hasOpenIssueReport(booking)) {
    return 'This booking has an active dispute. Resolve the dispute instead of cancelling.';
  }
  if (booking.status === 'cancelled') {
    return 'This booking is already cancelled.';
  }
  if (booking.status === 'completed') {
    return 'Completed bookings cannot be cancelled. Use dispute resolution or refund workflows if needed.';
  }
  if (!PRE_LESSON_CANCEL_STATUSES.has(booking.status)) {
    return 'Only pending or confirmed bookings can be cancelled before the lesson starts.';
  }
  const start = new Date(booking.scheduled_at).getTime();
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  if (Number.isFinite(start) && start <= t) {
    return 'The lesson has already started. Cancellation is no longer available.';
  }
  return 'Cancellation is not available for this booking.';
}

function softAttendanceLock(booking, payment) {
  const payout = String(booking?.payout_status || '');
  if (['processing', 'paid', 'forfeited'].includes(payout)) {
    return {
      allowed: false,
      code: 'attendance_locked_payout_finalized',
      message: 'Attendance outcome is locked because payout has already been finalized for this booking.',
    };
  }
  if (!payment) return { allowed: true, code: null, message: null };
  const escrow = String(payment.escrow_status || '');
  if (['released', 'pending_release', 'manual_payout_required'].includes(escrow)) {
    return {
      allowed: false,
      code: 'attendance_locked_escrow_released',
      message: 'Attendance outcome is locked because escrow has already been released for this booking.',
    };
  }
  if (isStudentPaymentRefunded(payment)) {
    return {
      allowed: false,
      code: 'attendance_locked_refund_finalized',
      message: 'Attendance outcome is locked because refund finalization has already occurred for this booking.',
    };
  }
  return { allowed: true, code: null, message: null };
}

/**
 * Soft gate for admin student/coach no-show marks.
 * @param {'student_no_show'|'coach_no_show'} targetStatus
 */
export function adminNoShowEligibility(booking, payment, targetStatus, now = Date.now()) {
  if (!booking) {
    return { allowed: false, code: 'booking_missing', message: 'Booking not found.' };
  }
  if (booking.status === targetStatus) {
    return {
      allowed: false,
      code: targetStatus === 'student_no_show' ? 'booking_already_student_no_show' : 'booking_already_coach_no_show',
      message: `This booking is already marked ${targetStatus}.`,
    };
  }
  if (!ADMIN_NO_SHOW_SOURCE_STATUSES.includes(booking.status)) {
    return {
      allowed: false,
      code: 'invalid_no_show_source_status',
      message: `Cannot mark ${targetStatus} from status ${booking.status}.`,
    };
  }
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    return {
      allowed: false,
      code: 'disputed_use_resolve_dispute',
      message: 'This booking has an active dispute. Resolve the dispute first to set final status and money outcome.',
    };
  }
  if (booking.attendance_finalized === true) {
    return {
      allowed: false,
      code: 'attendance_finalized_locked',
      message: 'Attendance is locked after dispute resolution. Open a new dispute if a correction is needed.',
    };
  }
  if (!lessonHasEnded(booking, now)) {
    return {
      allowed: false,
      code: 'lesson_not_ended',
      message: `Cannot mark ${targetStatus} before the lesson end time.`,
    };
  }
  const lock = softAttendanceLock(booking, payment);
  if (!lock.allowed) return lock;
  return { allowed: true, code: null, message: null };
}

export function canAdminMarkStudentNoShow(booking, payment, now = Date.now()) {
  return adminNoShowEligibility(booking, payment, 'student_no_show', now).allowed;
}

export function canAdminMarkCoachNoShow(booking, payment, now = Date.now()) {
  return adminNoShowEligibility(booking, payment, 'coach_no_show', now).allowed;
}

/**
 * Soft gate for POST /admin/bookings/:id/refund (full or partial).
 *
 * @returns {{ allowed: boolean, code: string|null, message: string|null, remaining: number|null }}
 */
export function adminRefundEligibility(booking, payment, now = Date.now()) {
  if (!booking) {
    return { allowed: false, code: 'booking_missing', message: 'Booking not found.', remaining: null };
  }

  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    return {
      allowed: false,
      code: 'refund_requires_dispute_resolution',
      message:
        'An active dispute exists for this booking. Resolve the dispute to apply any refund decision.',
      remaining: null,
    };
  }

  if (isFinancialReviewWindowOpen(booking, now)) {
    return {
      allowed: false,
      code: 'financial_review_window_open',
      message:
        'The 24-hour post-lesson review period is still open. Admin refunds wait until it ends, unless you resolve an in-app dispute.',
      remaining: null,
    };
  }

  if (!payment) {
    return {
      allowed: false,
      code: 'payment_not_found',
      message: 'No payment found for this booking.',
      remaining: null,
    };
  }

  const ps = String(payment.payment_status || '').toLowerCase();
  if (isStudentPaymentRefunded(payment) || ps === 'refunded') {
    return {
      allowed: false,
      code: 'refund_path_already_used',
      message:
        'A refund already exists for this booking. Additional admin refunds are blocked to keep one financial resolution per incident.',
      remaining: null,
    };
  }

  const remaining = refundableRemainingAmount(payment);
  if (remaining != null && remaining < 0.01) {
    return {
      allowed: false,
      code: 'refund_path_already_used',
      message:
        'A refund already exists for this booking. Additional admin refunds are blocked to keep one financial resolution per incident.',
      remaining: 0,
    };
  }

  // Public DTO may omit charge_id; captured (or pending_capture with money) is the soft signal.
  if (!['captured', 'pending_capture', 'partially_refunded'].includes(ps)) {
    return {
      allowed: false,
      code: 'no_refundable_charge',
      message: 'There is no captured student charge available to refund.',
      remaining: null,
    };
  }

  // Backend blocks any second refund path when hasAnyRefund — soft-block partials too if already partially refunded.
  if (ps === 'partially_refunded') {
    return {
      allowed: false,
      code: 'refund_path_already_used',
      message:
        'A refund already exists for this booking. Additional admin refunds are blocked to keep one financial resolution per incident.',
      remaining,
    };
  }

  return { allowed: true, code: null, message: null, remaining };
}

export function canAdminRefundBooking(booking, payment, now = Date.now()) {
  return adminRefundEligibility(booking, payment, now).allowed;
}

/** Soft: when admin may open an in-app dispute for a booking (admins bypass review window). */
export function canAdminCreateDispute(booking, now = Date.now()) {
  if (!booking) return false;
  if (hasOpenIssueReport(booking)) return false;
  const allowed = new Set([
    'awaiting_verification',
    'completed',
    'student_no_show',
    'coach_no_show',
    'disputed',
  ]);
  if (allowed.has(booking.status)) return true;
  if (booking.status === 'confirmed' && lessonHasEnded(booking, now)) return true;
  return false;
}

/**
 * Map admin cancel / refund / no-show API errors to operator-facing copy.
 */
export function formatAdminBookingActionError(err) {
  if (!err) return 'Action failed.';
  const code = err.code || err.payload?.code;
  const status = err.status;
  const message = err.message || '';

  if (code === 'refund_requires_dispute_resolution') {
    return 'An active dispute exists for this booking. Resolve the dispute to apply any refund decision.';
  }
  if (code === 'refund_path_already_used') {
    return 'A refund path was already used for this booking. Do not issue another admin refund.';
  }
  if (code === 'financial_review_window_open') {
    const until = err.payload?.review_until;
    return until
      ? `The 24-hour post-lesson review period is still open (until ${until}). Admin refunds wait until it ends, unless you resolve an in-app dispute.`
      : 'The 24-hour post-lesson review period is still open. Admin refunds wait until it ends, unless you resolve an in-app dispute.';
  }
  if (code === 'cancel_pre_lesson_only') {
    return 'Only pending or confirmed bookings can be cancelled before the lesson starts.';
  }
  if (code === 'disputed_use_dispute_flow' || code === 'disputed_use_resolve_dispute') {
    return 'This booking is disputed. Resolve via the dispute workflow instead.';
  }
  if (code === 'lesson_started_cancellation_unavailable') {
    return 'The lesson has already started. Cancellation is no longer available.';
  }
  if (code === 'booking_in_post_lesson_phase') {
    return 'This booking is in the post-lesson phase. Cancellation is no longer available.';
  }
  if (code === 'booking_already_cancelled') {
    return 'This booking has already been cancelled.';
  }
  if (code === 'booking_already_completed') {
    return 'This booking is already completed and cannot be cancelled.';
  }
  if (code === 'booking_already_student_no_show' || code === 'booking_already_coach_no_show') {
    return message || 'This booking is already marked with that no-show status.';
  }
  if (code === 'attendance_finalized_locked') {
    return message || 'Attendance is locked after dispute resolution.';
  }
  if (
    code === 'attendance_locked_payout_finalized'
    || code === 'attendance_locked_escrow_released'
    || code === 'attendance_locked_refund_finalized'
  ) {
    return message || 'Attendance outcome is locked for this booking.';
  }
  if (status === 404 && /payment/i.test(message)) {
    return 'Payment not found for this booking.';
  }
  if (status === 400 && /no Stripe charge|no refundable balance|exceeds remaining/i.test(message)) {
    return message;
  }
  return message || 'Action failed.';
}
