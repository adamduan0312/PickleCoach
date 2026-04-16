import {
  UserReliability,
  Booking,
  RescheduleHistory,
  CancellationHistory,
  User,
  UserRole,
  Dispute,
  DisputeType,
  sequelize,
} from '../models/index.js';
import { Op } from 'sequelize';

const parseEnvInt = (key, defaultValue) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return defaultValue;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
};

const parseEnvFloat = (key, defaultValue) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return defaultValue;
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
};

/** Tunable via env without deploy (defaults match Reliability V2 spec). */
const RELIABILITY_WINDOW_DAYS = parseEnvInt('RELIABILITY_WINDOW_DAYS', 90);
const RELIABILITY_DECAY_LAMBDA = parseEnvFloat('RELIABILITY_DECAY_LAMBDA', 0.03);
const RELIABILITY_SMOOTHING_K = parseEnvFloat('RELIABILITY_SMOOTHING_K', 5);

export const getReliabilityConfig = () => ({
  windowDays: RELIABILITY_WINDOW_DAYS,
  decayLambda: RELIABILITY_DECAY_LAMBDA,
  smoothingK: RELIABILITY_SMOOTHING_K,
});

const daysBetween = (a, b) => Math.max(0, (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
const getWindowStart = (now = new Date()) =>
  new Date(now.getTime() - RELIABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
const getDecayWeight = (eventDate, now = new Date()) => {
  if (!eventDate) return 0;
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
  if (Number.isNaN(d.getTime())) return 0;
  const ageInDays = daysBetween(now, d);
  return Math.exp(-RELIABILITY_DECAY_LAMBDA * ageInDays);
};
/**
 * Split each event into recent (full weight, in rolling window) vs decayed (0–1 weight, outside window).
 * Mutually exclusive: at the window boundary, event counts as recent only (d >= windowStart).
 */
const splitRecencyWeight = (eventDate, now = new Date(), windowStart = getWindowStart(now)) => {
  if (!eventDate) return { recent: 0, decayed: 0 };
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
  if (Number.isNaN(d.getTime())) return { recent: 0, decayed: 0 };
  if (d >= windowStart) return { recent: 1, decayed: 0 };
  return { recent: 0, decayed: getDecayWeight(d, now) };
};
const metricTotalWithDecay = (metrics, key) =>
  (Number(metrics?.[key]) || 0) + (Number(metrics?._decayed?.[key]) || 0);
/**
 * Denominator aligns with numerators: booking baseline = recent booking count + sum(decay weights for older bookings).
 * Same scheduled_at anchor as booking-based metrics; event metrics use their own timestamps with the same split.
 */
const reliabilityDenominator = (metrics) =>
  Math.max(
    1,
    (Number(metrics?._booking_baseline) || Number(metrics?.total_bookings) || 0) + RELIABILITY_SMOOTHING_K,
  );

const hasReliabilitySignal = (m) =>
  (Number(m?.total_bookings) || 0) > 0 || (Number(m?._booking_baseline) || 0) > 0;

/**
 * Resolved late_arrival disputes count only when BOTH gates are true:
 * - dispute type is reliability-eligible (`dispute_types.affects_reliability_score = 1`)
 * - chosen resolution action is reliability-eligible (`dispute_resolution_actions.affects_reliability_score = 1`)
 */
const lateArrivalAffectsReliabilityLiteral = () =>
  sequelize.literal(
    `EXISTS (
      SELECT 1
      FROM dispute_resolution_actions AS dra
      INNER JOIN dispute_types AS dt ON dt.id = disputes.dispute_type_id
      WHERE dra.id = disputes.resolution_action_id
        AND dra.affects_reliability_score = 1
        AND dt.affects_reliability_score = 1
    )`,
  );

const DISPUTE_PENALTY_WEIGHTS = {
  late_arrival: 5,
  lesson_not_completed: 10,
  // Keep coach_no_show aligned with no_show severity so incident impact is consistent
  // whether represented by booking status or a resolved coach_no_show dispute.
  coach_no_show: 35,
  misconduct: 25,
};

/**
 * Calculate reliability score for COACHES
 * Only penalizes events where affects_reliability = true
 * Penalizes: coach cancellations, reschedules, late arrivals, no-shows
 */
const calculateCoachReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.00;

  let score = 100.00;
  const denom = reliabilityDenominator(metrics);
  const penalized_reschedules = metricTotalWithDecay(metrics, 'reschedules');
  const late_cancels = metricTotalWithDecay(metrics, 'late_cancels');
  const late_arrivals = metricTotalWithDecay(metrics, 'late_arrivals');
  const no_shows = metricTotalWithDecay(metrics, 'no_shows');
  const coach_no_show_disputes = metricTotalWithDecay(metrics, 'coach_no_show_disputes');
  const misconduct_disputes = metricTotalWithDecay(metrics, 'misconduct_disputes');
  const lesson_not_completed_disputes = metricTotalWithDecay(metrics, 'lesson_not_completed_disputes');
  const coach_cancels_non_late = metricTotalWithDecay(metrics, 'coach_cancels');

  // Deduct points for negative behaviors specific to coaches
  // V2: rolling window + exponential decay + smoothing denominator.
  const penalizedReschedulePenalty = (penalized_reschedules / denom) * 5;
  const lateCancelPenalty = (late_cancels / denom) * 20;
  const lateArrivalPenalty = (late_arrivals / denom) * 5;
  const noShowPenalty = (no_shows / denom) * 35;
  const coachCancelNonLatePenalty = (coach_cancels_non_late / denom) * 10;
  const coachNoShowDisputePenalty =
    (coach_no_show_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.coach_no_show;
  const misconductDisputePenalty =
    (misconduct_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.misconduct;
  const lessonNotCompletedDisputePenalty =
    (lesson_not_completed_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.lesson_not_completed;

  score -= penalizedReschedulePenalty;
  score -= lateCancelPenalty;
  score -= lateArrivalPenalty;
  score -= noShowPenalty;
  score -= coachCancelNonLatePenalty;
  score -= coachNoShowDisputePenalty;
  score -= misconductDisputePenalty;
  score -= lessonNotCompletedDisputePenalty;

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate reliability score for STUDENTS
 * Only penalizes events where affects_reliability = true
 * Penalizes: student reschedules, late cancellations, late arrivals, no-shows, student cancellations
 */
const calculateStudentReliabilityScore = (metrics) => {
  const total_bookings = Number(metrics.total_bookings) || 0;
  if (total_bookings === 0 && (Number(metrics._booking_baseline) || 0) === 0) return 100.00;

  let score = 100.00;
  const denom = reliabilityDenominator(metrics);
  const reschedules = metricTotalWithDecay(metrics, 'reschedules');
  const late_cancels = metricTotalWithDecay(metrics, 'late_cancels');
  const late_arrivals = metricTotalWithDecay(metrics, 'late_arrivals');
  const no_shows = metricTotalWithDecay(metrics, 'no_shows');
  const student_cancels = metricTotalWithDecay(metrics, 'student_cancels');
  const coach_no_show_disputes = metricTotalWithDecay(metrics, 'coach_no_show_disputes');
  const misconduct_disputes = metricTotalWithDecay(metrics, 'misconduct_disputes');
  const lesson_not_completed_disputes = metricTotalWithDecay(metrics, 'lesson_not_completed_disputes');

  // Penalize behaviors that students control
  // V2: rolling window + exponential decay + smoothing denominator.
  const reschedulePenalty = (reschedules / denom) * 8;
  const lateCancelPenalty = (late_cancels / denom) * 15;
  const lateArrivalPenalty = (late_arrivals / denom) * 5;
  const noShowPenalty = (no_shows / denom) * 12;
  const studentCancelPenalty = (student_cancels / denom) * 12;
  const coachNoShowDisputePenalty =
    (coach_no_show_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.coach_no_show;
  const misconductDisputePenalty =
    (misconduct_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.misconduct;
  const lessonNotCompletedDisputePenalty =
    (lesson_not_completed_disputes / denom) * DISPUTE_PENALTY_WEIGHTS.lesson_not_completed;

  score -= reschedulePenalty;
  score -= lateCancelPenalty;
  score -= lateArrivalPenalty;
  score -= noShowPenalty;
  score -= studentCancelPenalty;
  score -= coachNoShowDisputePenalty;
  score -= misconductDisputePenalty;
  score -= lessonNotCompletedDisputePenalty;

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate coach-specific reliability metrics
 * Only counts bookings where user is the coach
 */
const calculateCoachMetrics = async (userId) => {
  const now = new Date();
  const windowStart = getWindowStart(now);
  // Get bookings where user is the COACH
  const coachBookings = await Booking.findAll({
    where: { coach_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const coachBookingIds = coachBookings.map(b => b.id);
  let recentBookings = 0;
  let decayedBookings = 0;
  for (const b of coachBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart);
    recentBookings += split.recent;
    decayedBookings += split.decayed;
  }

  if (coachBookingIds.length === 0) {
    return {
      total_bookings: 0,
      _booking_baseline: 0,
      _decayed: {},
      reschedules: 0,
      paid_reschedules: 0,
      late_cancels: 0,
      late_arrivals: 0,
      coach_no_show_disputes: 0,
      misconduct_disputes: 0,
      lesson_not_completed_disputes: 0,
      no_shows: 0,
      coach_cancels: 0,
    };
  }

  // Count coach-requested reschedules that are penalized (affects_reliability = true).
  const coachReschedules = await RescheduleHistory.findAll({
    where: {
      booking_id: { [Op.in]: coachBookingIds },
      requested_by: 'coach',
      affects_reliability: true, // Only count penalized reschedules
    },
    attributes: ['id', 'requested_at'],
  });
  let penalized_reschedules = 0;
  let decayed_penalized_reschedules = 0;
  for (const r of coachReschedules) {
    const split = splitRecencyWeight(r.requested_at, now, windowStart);
    penalized_reschedules += split.recent;
    decayed_penalized_reschedules += split.decayed;
  }

  // Get cancellations for coach bookings
  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: coachBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  // Count late cancellations (within 24 hours BEFORE scheduled time) where coach cancelled and affects_reliability = true
  let late_cancels = 0;
  let decayed_late_cancels = 0;
  let coach_cancels_non_late = 0;
  let decayed_coach_cancels_non_late = 0;
  for (const c of cancellations) {
    if (c.cancelled_by !== 'coach' || !c.affects_reliability) continue;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    const split = splitRecencyWeight(c.cancelled_at, now, windowStart);
    if (hoursBefore >= 0 && hoursBefore < 24) {
      late_cancels += split.recent;
      decayed_late_cancels += split.decayed;
      continue;
    }
    if (hoursBefore < 0 || hoursBefore >= 24) {
      coach_cancels_non_late += split.recent;
      decayed_coach_cancels_non_late += split.decayed;
    }
  }

  // Count resolved late-arrival disputes raised by students for this coach's bookings.
  // This is the current explicit proxy for "coach showed up late".
  const lateArrivalDisputeType = await DisputeType.findOne({
    attributes: ['id'],
    where: { code: 'late_arrival' },
  });
  let late_arrivals = 0;
  let decayed_late_arrivals = 0;
  if (lateArrivalDisputeType && coachBookingIds.length) {
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: coachBookingIds } },
          { dispute_type_id: lateArrivalDisputeType.id },
          { opened_by: 'student' },
          { status: 'resolved' },
          lateArrivalAffectsReliabilityLiteral(),
        ],
      },
      attributes: ['booking_id', 'resolved_at', 'opened_at'],
    });
    const latestByBooking = new Map();
    for (const row of rows) {
      const prev = latestByBooking.get(row.booking_id);
      const at = new Date(row.resolved_at || row.opened_at || now);
      if (!prev || at > prev) latestByBooking.set(row.booking_id, at);
    }
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart);
      late_arrivals += split.recent;
      decayed_late_arrivals += split.decayed;
    }
  }

  const behaviorDisputeTypes = await DisputeType.findAll({
    attributes: ['id', 'code'],
    where: {
      code: { [Op.in]: ['coach_no_show', 'misconduct', 'lesson_not_completed'] },
      affects_reliability_score: true,
    },
  });
  const behaviorDisputeTypeIds = Object.fromEntries(
    behaviorDisputeTypes.map((t) => [t.code, t.id]),
  );
  /**
   * When `skipIfBookingCoachNoShow`: do not count a resolved coach_no_show dispute if the booking is
   * already `coach_no_show` — the booking outcome is counted under `no_shows` (admin endpoint / status).
   * Avoids double-penalizing the same incident via dispute + booking-status paths.
   */
  const countResolvedBehaviorDisputes = async (disputeTypeId, options = {}) => {
    const { skipIfBookingCoachNoShow = false } = options;
    if (!disputeTypeId) return { recent: 0, decayed: 0 };
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: coachBookingIds } },
          { dispute_type_id: disputeTypeId },
          { opened_by: 'student' },
          { status: 'resolved' },
          lateArrivalAffectsReliabilityLiteral(),
        ],
      },
      attributes: ['booking_id', 'resolved_at', 'opened_at'],
      ...(skipIfBookingCoachNoShow
        ? {
            include: [{ model: Booking, as: 'booking', attributes: ['status'], required: true }],
          }
        : {}),
    });
    const latestByBooking = new Map();
    for (const row of rows) {
      if (skipIfBookingCoachNoShow && row.booking?.status === 'coach_no_show') {
        continue;
      }
      const prev = latestByBooking.get(row.booking_id);
      const at = new Date(row.resolved_at || row.opened_at || now);
      if (!prev || at > prev) latestByBooking.set(row.booking_id, at);
    }
    let recent = 0;
    let decayed = 0;
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart);
      recent += split.recent;
      decayed += split.decayed;
    }
    return { recent, decayed };
  };
  const coachNoShowDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.coach_no_show,
    { skipIfBookingCoachNoShow: true },
  );
  const misconductDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.misconduct,
  );
  const lessonNotCompletedDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.lesson_not_completed,
  );

  // Calculate no-shows: bookings that were scheduled but never completed or cancelled
  // A no-show is a booking that:
  // 1. Has status 'confirmed' or 'awaiting_verification'
  // 2. Scheduled time has passed (more than 2 hours ago)
  // 3. Has a dispute opened for legacy 'no_show' or reporting type 'coach_no_show', OR booking was never completed/cancelled
  const noShowDisputeTypes = await DisputeType.findAll({
    attributes: ['id'],
    where: { code: { [Op.in]: ['no_show', 'coach_no_show'] } },
  });
  const noShowTypeIds = noShowDisputeTypes.map((t) => t.id);

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const noShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: coachBookingIds },
      status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
      scheduled_at: { [Op.lt]: twoHoursAgo },
    },
  });

  const noShowCandidateIds = noShowBookings.map((b) => b.id);
  let bookingIdsWithNoShowDispute = new Set();
  if (noShowTypeIds.length > 0 && noShowCandidateIds.length > 0) {
    const disputeRows = await Dispute.findAll({
      where: {
        booking_id: { [Op.in]: noShowCandidateIds },
        dispute_type_id: { [Op.in]: noShowTypeIds },
      },
      attributes: ['booking_id'],
    });
    bookingIdsWithNoShowDispute = new Set(disputeRows.map((d) => d.booking_id));
  }
  let bookingIdsWithCancellation = new Set();
  if (noShowCandidateIds.length > 0) {
    const cancelRows = await CancellationHistory.findAll({
      where: { booking_id: { [Op.in]: noShowCandidateIds } },
      attributes: ['booking_id'],
    });
    bookingIdsWithCancellation = new Set(cancelRows.map((c) => c.booking_id));
  }

  let no_shows = 0;
  let decayed_no_shows = 0;
  for (const booking of noShowBookings) {
    if (noShowTypeIds.length && bookingIdsWithNoShowDispute.has(booking.id)) {
      const split = splitRecencyWeight(booking.scheduled_at, now, windowStart);
      no_shows += split.recent;
      decayed_no_shows += split.decayed;
      continue;
    }
    if (!bookingIdsWithCancellation.has(booking.id) && booking.status !== 'completed') {
      const hoursPastScheduled = (now - new Date(booking.scheduled_at)) / (1000 * 60 * 60);
      if (hoursPastScheduled > 24) {
        const split = splitRecencyWeight(booking.scheduled_at, now, windowStart);
        no_shows += split.recent;
        decayed_no_shows += split.decayed;
      }
    }
  }

  const coachNoShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: coachBookingIds },
      status: 'coach_no_show',
    },
    attributes: ['scheduled_at'],
  });
  for (const b of coachNoShowBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart);
    no_shows += split.recent;
    decayed_no_shows += split.decayed;
  }

  // Calculate paid reschedules from reschedule history
  const paidReschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: coachBookingIds },
      requested_by: 'coach',
      paid_reschedule: true,
    },
  });

  return {
    total_bookings: recentBookings,
    _booking_baseline: recentBookings + decayedBookings,
    _decayed: {
      reschedules: decayed_penalized_reschedules,
      late_cancels: decayed_late_cancels,
      late_arrivals: decayed_late_arrivals,
      coach_no_show_disputes: coachNoShowDisputes.decayed,
      misconduct_disputes: misconductDisputes.decayed,
      lesson_not_completed_disputes: lessonNotCompletedDisputes.decayed,
      no_shows: decayed_no_shows,
      coach_cancels: decayed_coach_cancels_non_late,
    },
    // Persist under existing schema key; semantic meaning is penalized-only.
    reschedules: penalized_reschedules,
    paid_reschedules: paidReschedules,
    late_cancels,
    late_arrivals,
    coach_no_show_disputes: coachNoShowDisputes.recent,
    misconduct_disputes: misconductDisputes.recent,
    lesson_not_completed_disputes: lessonNotCompletedDisputes.recent,
    no_shows,
    // Persist under existing schema key; semantic meaning is non-late only.
    coach_cancels: coach_cancels_non_late,
  };
};

/**
 * Calculate student-specific reliability metrics
 * Only counts bookings where user is the student
 */
const calculateStudentMetrics = async (userId) => {
  const now = new Date();
  const windowStart = getWindowStart(now);
  // Get bookings where user is the STUDENT
  const studentBookings = await Booking.findAll({
    where: { primary_student_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const studentBookingIds = studentBookings.map(b => b.id);
  let recentBookings = 0;
  let decayedBookings = 0;
  for (const b of studentBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart);
    recentBookings += split.recent;
    decayedBookings += split.decayed;
  }

  if (studentBookingIds.length === 0) {
    return {
      total_bookings: 0,
      _booking_baseline: 0,
      _decayed: {},
      reschedules: 0,
      late_cancels: 0,
      late_arrivals: 0,
      coach_no_show_disputes: 0,
      misconduct_disputes: 0,
      lesson_not_completed_disputes: 0,
      no_shows: 0,
      student_cancels: 0,
    };
  }

  // Count reschedules requested by the student where affects_reliability = true
  const studentReschedules = await RescheduleHistory.findAll({
    where: {
      booking_id: { [Op.in]: studentBookingIds },
      requested_by: 'student',
      affects_reliability: true, // Only count penalized reschedules
    },
    attributes: ['requested_at'],
  });
  let reschedules = 0;
  let decayed_reschedules = 0;
  for (const r of studentReschedules) {
    const split = splitRecencyWeight(r.requested_at, now, windowStart);
    reschedules += split.recent;
    decayed_reschedules += split.decayed;
  }

  // Get cancellations for student bookings
  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: studentBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  // Count late cancellations (within 24 hours BEFORE scheduled time) where STUDENT cancelled and affects_reliability = true
  let late_cancels = 0;
  let decayed_late_cancels = 0;
  let student_cancels = 0;
  let decayed_student_cancels = 0;
  for (const c of cancellations) {
    if (c.cancelled_by !== 'student' || !c.affects_reliability) continue;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    const split = splitRecencyWeight(c.cancelled_at, now, windowStart);
    if (hoursBefore >= 0 && hoursBefore < 24) {
      late_cancels += split.recent;
      decayed_late_cancels += split.decayed;
      continue;
    }
    if (hoursBefore < 0 || hoursBefore >= 24) {
      student_cancels += split.recent;
      decayed_student_cancels += split.decayed;
    }
  }

  // Count resolved late-arrival disputes raised by coaches for this student's bookings.
  // This is the current explicit proxy for "student showed up late".
  const lateArrivalDisputeType = await DisputeType.findOne({
    attributes: ['id'],
    where: { code: 'late_arrival' },
  });
  let late_arrivals = 0;
  let decayed_late_arrivals = 0;
  if (lateArrivalDisputeType && studentBookingIds.length) {
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: studentBookingIds } },
          { dispute_type_id: lateArrivalDisputeType.id },
          { opened_by: 'coach' },
          { status: 'resolved' },
          lateArrivalAffectsReliabilityLiteral(),
        ],
      },
      attributes: ['booking_id', 'resolved_at', 'opened_at'],
    });
    const latestByBooking = new Map();
    for (const row of rows) {
      const prev = latestByBooking.get(row.booking_id);
      const at = new Date(row.resolved_at || row.opened_at || now);
      if (!prev || at > prev) latestByBooking.set(row.booking_id, at);
    }
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart);
      late_arrivals += split.recent;
      decayed_late_arrivals += split.decayed;
    }
  }

  const behaviorDisputeTypes = await DisputeType.findAll({
    attributes: ['id', 'code'],
    where: {
      code: { [Op.in]: ['coach_no_show', 'misconduct', 'lesson_not_completed'] },
      affects_reliability_score: true,
    },
  });
  const behaviorDisputeTypeIds = Object.fromEntries(
    behaviorDisputeTypes.map((t) => [t.code, t.id]),
  );
  /**
   * When `skipIfBookingStudentNoShow`: do not count a resolved coach_no_show dispute (coach-reported)
   * if the booking is already `no_show` — explicit student no-show is counted under `no_shows`.
   */
  const countResolvedBehaviorDisputes = async (disputeTypeId, options = {}) => {
    const { skipIfBookingStudentNoShow = false } = options;
    if (!disputeTypeId) return { recent: 0, decayed: 0 };
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: studentBookingIds } },
          { dispute_type_id: disputeTypeId },
          { opened_by: 'coach' },
          { status: 'resolved' },
          lateArrivalAffectsReliabilityLiteral(),
        ],
      },
      attributes: ['booking_id', 'resolved_at', 'opened_at'],
      ...(skipIfBookingStudentNoShow
        ? {
            include: [{ model: Booking, as: 'booking', attributes: ['status'], required: true }],
          }
        : {}),
    });
    const latestByBooking = new Map();
    for (const row of rows) {
      if (skipIfBookingStudentNoShow && row.booking?.status === 'no_show') {
        continue;
      }
      const prev = latestByBooking.get(row.booking_id);
      const at = new Date(row.resolved_at || row.opened_at || now);
      if (!prev || at > prev) latestByBooking.set(row.booking_id, at);
    }
    let recent = 0;
    let decayed = 0;
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart);
      recent += split.recent;
      decayed += split.decayed;
    }
    return { recent, decayed };
  };
  const coachNoShowDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.coach_no_show,
    { skipIfBookingStudentNoShow: true },
  );
  const misconductDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.misconduct,
  );
  const lessonNotCompletedDisputes = await countResolvedBehaviorDisputes(
    behaviorDisputeTypeIds.lesson_not_completed,
  );

  // No-shows: (1) explicit student no_show status (same idea as coach_no_show for coaches),
  // plus (2) inferred from stale confirmed/awaiting + dispute / cancellation heuristics.
  const noShowDisputeTypes = await DisputeType.findAll({
    attributes: ['id'],
    where: { code: { [Op.in]: ['no_show', 'coach_no_show'] } },
  });
  const noShowTypeIds = noShowDisputeTypes.map((t) => t.id);

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const noShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: studentBookingIds },
      status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
      scheduled_at: { [Op.lt]: twoHoursAgo },
    },
  });

  const studentNoShowCandidateIds = noShowBookings.map((b) => b.id);
  let studentBookingIdsWithNoShowDispute = new Set();
  if (noShowTypeIds.length > 0 && studentNoShowCandidateIds.length > 0) {
    const disputeRows = await Dispute.findAll({
      where: {
        booking_id: { [Op.in]: studentNoShowCandidateIds },
        dispute_type_id: { [Op.in]: noShowTypeIds },
      },
      attributes: ['booking_id'],
    });
    studentBookingIdsWithNoShowDispute = new Set(disputeRows.map((d) => d.booking_id));
  }
  let studentBookingIdsWithCancellation = new Set();
  if (studentNoShowCandidateIds.length > 0) {
    const cancelRows = await CancellationHistory.findAll({
      where: { booking_id: { [Op.in]: studentNoShowCandidateIds } },
      attributes: ['booking_id'],
    });
    studentBookingIdsWithCancellation = new Set(cancelRows.map((c) => c.booking_id));
  }

  let no_shows = 0;
  let decayed_no_shows = 0;
  for (const booking of noShowBookings) {
    if (noShowTypeIds.length && studentBookingIdsWithNoShowDispute.has(booking.id)) {
      const split = splitRecencyWeight(booking.scheduled_at, now, windowStart);
      no_shows += split.recent;
      decayed_no_shows += split.decayed;
      continue;
    }
    if (!studentBookingIdsWithCancellation.has(booking.id) && booking.status !== 'completed') {
      const hoursPastScheduled = (now - new Date(booking.scheduled_at)) / (1000 * 60 * 60);
      if (hoursPastScheduled > 24) {
        const split = splitRecencyWeight(booking.scheduled_at, now, windowStart);
        no_shows += split.recent;
        decayed_no_shows += split.decayed;
      }
    }
  }

  const explicitStudentNoShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: studentBookingIds },
      status: 'no_show',
    },
    attributes: ['scheduled_at'],
  });
  for (const b of explicitStudentNoShowBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart);
    no_shows += split.recent;
    decayed_no_shows += split.decayed;
  }

  return {
    total_bookings: recentBookings,
    _booking_baseline: recentBookings + decayedBookings,
    _decayed: {
      reschedules: decayed_reschedules,
      late_cancels: decayed_late_cancels,
      late_arrivals: decayed_late_arrivals,
      coach_no_show_disputes: coachNoShowDisputes.decayed,
      misconduct_disputes: misconductDisputes.decayed,
      lesson_not_completed_disputes: lessonNotCompletedDisputes.decayed,
      no_shows: decayed_no_shows,
      student_cancels: decayed_student_cancels,
    },
    reschedules,
    late_cancels,
    late_arrivals,
    coach_no_show_disputes: coachNoShowDisputes.recent,
    misconduct_disputes: misconductDisputes.recent,
    lesson_not_completed_disputes: lessonNotCompletedDisputes.recent,
    no_shows,
    student_cancels,
  };
};

/**
 * Update reliability for one role dimension (coach vs student) so dual-role users
 * get separate rows and scores.
 *
 * @param {number} userId
 * @param {'coach'|'student'} role
 */
export const updateUserReliability = async (userId, role) => {
  if (role !== 'coach' && role !== 'student') {
    throw new Error('updateUserReliability: role must be "coach" or "student"');
  }

  const user = await User.findByPk(userId, {
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  const roles = user.userRoles?.map((r) => r.role) ?? [];
  if (roles.includes('admin')) {
    return null;
  }
  if (role === 'coach' && !roles.includes('coach')) {
    return null;
  }
  if (role === 'student' && !roles.includes('student')) {
    return null;
  }

  let metrics = {
    total_bookings: 0,
    reschedules: 0,
    paid_reschedules: 0,
    late_cancels: 0,
    late_arrivals: 0,
    coach_no_show_disputes: 0,
    misconduct_disputes: 0,
    lesson_not_completed_disputes: 0,
    no_shows: 0,
    coach_cancels: 0,
    student_cancels: 0,
  };
  let score = 100.0;

  if (role === 'coach') {
    const coachMetrics = await calculateCoachMetrics(userId);
    metrics = { ...coachMetrics, student_cancels: 0 };
    if (hasReliabilitySignal(coachMetrics)) {
      score = calculateCoachReliabilityScore(coachMetrics);
    }
  } else {
    const studentMetrics = await calculateStudentMetrics(userId);
    metrics = { ...studentMetrics, coach_cancels: 0, paid_reschedules: 0 };
    if (hasReliabilitySignal(studentMetrics)) {
      score = calculateStudentReliabilityScore(studentMetrics);
    }
  }

  const [reliability, created] = await UserReliability.findOrCreate({
    where: { user_id: userId, role },
    defaults: {
      user_id: userId,
      role,
      total_bookings: metrics.total_bookings,
      reschedules: metrics.reschedules,
      paid_reschedules: metrics.paid_reschedules || 0,
      late_cancels: metrics.late_cancels,
      late_arrivals: metrics.late_arrivals,
      coach_no_show_disputes: metrics.coach_no_show_disputes || 0,
      misconduct_disputes: metrics.misconduct_disputes || 0,
      lesson_not_completed_disputes: metrics.lesson_not_completed_disputes || 0,
      no_shows: metrics.no_shows,
      coach_cancels: metrics.coach_cancels || 0,
      reliability_score: score,
    },
  });

  if (!created) {
    await reliability.update({
      total_bookings: metrics.total_bookings,
      reschedules: metrics.reschedules,
      paid_reschedules: metrics.paid_reschedules || 0,
      late_cancels: metrics.late_cancels,
      late_arrivals: metrics.late_arrivals,
      coach_no_show_disputes: metrics.coach_no_show_disputes || 0,
      misconduct_disputes: metrics.misconduct_disputes || 0,
      lesson_not_completed_disputes: metrics.lesson_not_completed_disputes || 0,
      no_shows: metrics.no_shows,
      coach_cancels: metrics.coach_cancels || 0,
      reliability_score: score,
    });
  }

  return reliability;
};