/**
 * Canonical booking lifecycle transitions (`bookings.status`).
 * All status changes should go through `canTransitionBookingStatus` + `applyBookingStatusTransition`
 * so invalid arcs fail in one place (controllers, workers, payment webhooks).
 *
 * Attendance outcome rules (`student_no_show` / `coach_no_show`) still delegate to
 * `utils/bookingAttendanceStatus.js` for source-set validation when those statuses are involved.
 */

import {
  ADMIN_MARK_NO_SHOW_SOURCE_STATUSES,
  DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES,
  validateAttendanceOutcomeTransition,
} from '../utils/bookingAttendanceStatus.js';
import { messagingLockedValueForStatus } from '../utils/bookingMessaging.js';
import { ensureBookingConversation } from '../utils/bookingConversationSummary.js';

/** @typedef {import('../models/Booking.js').default} BookingModel */

export const BOOKING_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'awaiting_verification',
  'completed',
  'cancelled',
  'disputed',
  'student_no_show',
  'coach_no_show',
]);

/**
 * Named transition channels — use the narrowest via that matches the caller
 * (audits/logs can reference the same string).
 */
export const BookingTransitionVia = Object.freeze({
  /** Student PI succeeded after coach accept (webhook) or non-capture booking payment success */
  PAYMENT_CAPTURE_WEBHOOK: 'payment_capture_webhook',
  /** Coach accepted a booking that has no payment row (legacy / edge) */
  COACH_ACCEPT_WITHOUT_PAYMENT: 'coach_accept_without_payment',
  /** `cancelPaymentOnCoachDecline` */
  COACH_DECLINE: 'coach_decline',
  /** Coach acceptance timeout worker (`expirePendingBookingNoCoachResponse`) */
  SYSTEM_EXPIRE_PENDING: 'system_expire_pending',
  /** Stripe authorization failed before coach could accept */
  PAYMENT_AUTHORIZATION_FAILED: 'payment_authorization_failed',
  /** Pre-lesson cancel API (student/coach/admin wrapper) */
  PRE_LESSON_CANCEL: 'pre_lesson_cancel',
  /** Background: lesson end passed while still confirmed */
  WORKER_LESSON_END_TO_AWAITING_VERIFICATION: 'worker_lesson_end_to_awaiting_verification',
  /** Coach POST complete or auto-complete worker */
  MARK_COMPLETED: 'mark_completed',
  /** Coach POST student-no-show */
  COACH_MARK_STUDENT_NO_SHOW: 'coach_mark_student_no_show',
  /** Admin POST student-no-show */
  ADMIN_MARK_STUDENT_NO_SHOW: 'admin_mark_student_no_show',
  /** Admin POST coach-no-show */
  ADMIN_MARK_COACH_NO_SHOW: 'admin_mark_coach_no_show',
  /** Stripe chargeback / dispute sync (booking parked in disputed) */
  STRIPE_DISPUTE_OPEN: 'stripe_dispute_open',
  /** Stripe terminal chargeback — release booking from disputed parking */
  STRIPE_DISPUTE_TERMINAL: 'stripe_dispute_terminal',
  /** `PUT /api/disputes/:id/resolve` attendance outcome */
  DISPUTE_RESOLVE_ATTENDANCE: 'dispute_resolve_attendance',
  /** Behavior dispute resolve when booking was `disputed` → release to completed */
  DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING: 'dispute_resolve_behavior_on_disputed_booking',
  /** `other` dispute resolve when booking was `disputed` → release to completed */
  DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING: 'dispute_resolve_catchall_on_disputed_booking',
});

/** @type {Map<string, Set<string>>} key = `${from}\t${to}` */
const EDGE_VIAS = new Map();

function addEdge(from, to, vias) {
  const key = `${from}\t${to}`;
  if (!EDGE_VIAS.has(key)) EDGE_VIAS.set(key, new Set());
  const set = EDGE_VIAS.get(key);
  for (const v of vias) set.add(v);
}

function buildEdges() {
  addEdge('pending', 'confirmed', [
    BookingTransitionVia.PAYMENT_CAPTURE_WEBHOOK,
    BookingTransitionVia.COACH_ACCEPT_WITHOUT_PAYMENT,
  ]);
  addEdge('pending', 'cancelled', [
    BookingTransitionVia.COACH_DECLINE,
    BookingTransitionVia.SYSTEM_EXPIRE_PENDING,
    BookingTransitionVia.PRE_LESSON_CANCEL,
    BookingTransitionVia.PAYMENT_AUTHORIZATION_FAILED,
  ]);

  addEdge('confirmed', 'awaiting_verification', [BookingTransitionVia.WORKER_LESSON_END_TO_AWAITING_VERIFICATION]);

  addEdge('confirmed', 'completed', [BookingTransitionVia.MARK_COMPLETED]);
  addEdge('awaiting_verification', 'completed', [BookingTransitionVia.MARK_COMPLETED]);

  addEdge('confirmed', 'cancelled', [BookingTransitionVia.PRE_LESSON_CANCEL]);
  // pre-lesson cancel only allows pending|confirmed in controller; keep graph aligned
  // (no confirmed→cancelled via other vias)

  addEdge('confirmed', 'student_no_show', [
    BookingTransitionVia.COACH_MARK_STUDENT_NO_SHOW,
    BookingTransitionVia.ADMIN_MARK_STUDENT_NO_SHOW,
  ]);
  addEdge('awaiting_verification', 'student_no_show', [
    BookingTransitionVia.COACH_MARK_STUDENT_NO_SHOW,
    BookingTransitionVia.ADMIN_MARK_STUDENT_NO_SHOW,
  ]);

  for (const from of ADMIN_MARK_NO_SHOW_SOURCE_STATUSES) {
    addEdge(from, 'coach_no_show', [BookingTransitionVia.ADMIN_MARK_COACH_NO_SHOW]);
  }
  for (const from of ADMIN_MARK_NO_SHOW_SOURCE_STATUSES) {
    addEdge(from, 'student_no_show', [BookingTransitionVia.ADMIN_MARK_STUDENT_NO_SHOW]);
  }

  const stripeDisputeSources = BOOKING_STATUSES.filter((s) => s !== 'cancelled');
  for (const from of stripeDisputeSources) {
    addEdge(from, 'disputed', [BookingTransitionVia.STRIPE_DISPUTE_OPEN]);
  }
  // Chargeback can still surface after a cancel in edge cases — allow cancel → disputed
  addEdge('cancelled', 'disputed', [BookingTransitionVia.STRIPE_DISPUTE_OPEN]);

  const attendanceOutcomes = ['student_no_show', 'coach_no_show'];
  for (const from of [
    ...new Set([
      ...DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES,
      'pending',
      'confirmed',
      'awaiting_verification',
      'completed',
      'disputed',
      'student_no_show',
      'coach_no_show',
    ]),
  ]) {
    for (const to of attendanceOutcomes) {
      addEdge(from, to, [BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE]);
    }
  }

  addEdge('disputed', 'completed', [
    BookingTransitionVia.DISPUTE_RESOLVE_BEHAVIOR_ON_DISPUTED_BOOKING,
    BookingTransitionVia.DISPUTE_RESOLVE_CATCHALL_ON_DISPUTED_BOOKING,
    BookingTransitionVia.STRIPE_DISPUTE_TERMINAL,
  ]);
}

buildEdges();

/**
 * @param {string} from
 * @param {string} to
 * @param {string} via
 * @returns {{ ok: true, noop?: boolean } | { ok: false, code: string, message: string }}
 */
export function canTransitionBookingStatus(from, to, via) {
  if (from === to) {
    return { ok: true, noop: true };
  }
  const key = `${from}\t${to}`;
  const allowedVias = EDGE_VIAS.get(key);
  if (!allowedVias || !allowedVias.has(via)) {
    const dests = listAllowedDestinations(from);
    return {
      ok: false,
      code: 'booking_transition_not_allowed',
      message:
        allowedVias && !allowedVias.has(via)
          ? `Booking cannot transition from "${from}" to "${to}" via "${via}". Allowed channels: ${[...allowedVias].join(', ')}.`
          : `Booking cannot transition from "${from}" to "${to}".${dests.length ? ` Allowed destinations from "${from}": ${dests.join(', ')}.` : ''}`,
    };
  }

  if (via === BookingTransitionVia.DISPUTE_RESOLVE_ATTENDANCE) {
    const t = validateAttendanceOutcomeTransition(
      from,
      to,
      new Set(DISPUTE_RESOLVE_ATTENDANCE_SOURCE_STATUSES),
    );
    if (!t.ok) {
      return { ok: false, code: t.code || 'invalid_attendance_status_transition', message: t.message };
    }
  }

  if (via === BookingTransitionVia.COACH_MARK_STUDENT_NO_SHOW) {
    const t = validateAttendanceOutcomeTransition(
      from,
      'student_no_show',
      new Set(['confirmed', 'awaiting_verification']),
    );
    if (!t.ok) {
      return { ok: false, code: t.code || 'invalid_attendance_status_transition', message: t.message };
    }
  }

  if (via === BookingTransitionVia.ADMIN_MARK_STUDENT_NO_SHOW) {
    const ta = validateAttendanceOutcomeTransition(
      from,
      'student_no_show',
      new Set(ADMIN_MARK_NO_SHOW_SOURCE_STATUSES),
    );
    if (!ta.ok) {
      return { ok: false, code: ta.code || 'invalid_attendance_status_transition', message: ta.message };
    }
  }

  if (via === BookingTransitionVia.ADMIN_MARK_COACH_NO_SHOW) {
    const t = validateAttendanceOutcomeTransition(from, 'coach_no_show', new Set(ADMIN_MARK_NO_SHOW_SOURCE_STATUSES));
    if (!t.ok) {
      return { ok: false, code: t.code || 'invalid_attendance_status_transition', message: t.message };
    }
  }

  return { ok: true };
}

/** @param {string} from */
function listAllowedDestinations(from) {
  const out = [];
  for (const key of EDGE_VIAS.keys()) {
    const [f, t] = key.split('\t');
    if (f === from) out.push(t);
  }
  return [...new Set(out)].sort();
}

/**
 * Apply a validated `status` change plus optional columns (payout_status, cancelled_*, …).
 * `messaging_locked` is always derived from `toStatus` — do not pass it in `patch`.
 *
 * @param {BookingModel} booking — Sequelize instance; `status` read from current model state
 * @param {{ toStatus: string, via: string, patch?: Record<string, unknown>, options?: import('sequelize').UpdateOptions }} p
 */
export async function applyBookingStatusTransition(booking, { toStatus, via, patch = {}, options = {} }) {
  const check = canTransitionBookingStatus(booking.status, toStatus, via);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code;
    err.statusCode = 400;
    throw err;
  }
  if (check.noop) {
    return booking;
  }
  const { messaging_locked: _ignored, ...restPatch } = patch;
  const payload = {
    ...restPatch,
    status: toStatus,
    messaging_locked: messagingLockedValueForStatus(toStatus),
  };
  await booking.update(payload, options);
  booking.status = toStatus;
  booking.messaging_locked = messagingLockedValueForStatus(toStatus);

  if (toStatus === 'confirmed') {
    await ensureBookingConversation(booking.id, { transaction: options.transaction });
  }

  return booking;
}

/**
 * Bulk SQL updates (workers) cannot attach a Sequelize instance; validate each
 * `(fromStatus → toStatus)` pair before running `Booking.update`.
 */
export function assertBulkBookingStatusTransition(fromStatus, toStatus, via) {
  const check = canTransitionBookingStatus(fromStatus, toStatus, via);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code;
    err.statusCode = 400;
    throw err;
  }
  return check;
}
