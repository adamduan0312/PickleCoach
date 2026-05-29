import {
  UserReliability,
  Booking,
  Payment,
  RescheduleHistory,
  CancellationHistory,
  User,
  UserRole,
  Dispute,
  DisputeType,
  sequelize,
} from '../models/index.js';
import { Op } from 'sequelize';
import { getReliabilityConfig } from './reliabilityConstants.js';
import {
  buildCanonicalReliabilityMetrics,
  calculateReliabilityScoreFromCanonical,
  flattenCanonicalForPersistence,
} from './reliabilityEngine.js';

export { getReliabilityConfig };

const daysBetween = (a, b) => Math.max(0, (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
const getWindowStart = (now = new Date(), windowDays) =>
  new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
const getDecayWeight = (eventDate, decayLambda, now = new Date()) => {
  if (!eventDate) return 0;
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
  if (Number.isNaN(d.getTime())) return 0;
  const ageInDays = daysBetween(now, d);
  return Math.exp(-decayLambda * ageInDays);
};

/**
 * Split each event into recent (full weight, in rolling window) vs decayed (0–1 weight, outside window).
 * Mutually exclusive: at the window boundary, event counts as recent only (d >= windowStart).
 */
const splitRecencyWeight = (eventDate, now, windowStart, decayLambda) => {
  if (!eventDate) return { recent: 0, decayed: 0 };
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
  if (Number.isNaN(d.getTime())) return { recent: 0, decayed: 0 };
  if (d >= windowStart) return { recent: 1, decayed: 0 };
  return { recent: 0, decayed: getDecayWeight(d, decayLambda, now) };
};

const hasReliabilitySignal = (raw) =>
  (Number(raw?.booking_baseline_recent) || 0) + (Number(raw?.booking_baseline_decayed) || 0) > 0;

/**
 * Paid + penalized + reliability-affecting reschedules whose linked payment row is captured
 * (or partially_refunded). Single definition used for persistence and public reliability APIs.
 * Not a scoring input; stored on `user_reliability.paid_reschedules` for coach and student rows.
 */
const countPaidPenalizedCapturedReschedules = async (bookingIds, requestedBy) => {
  if (!bookingIds.length) return 0;
  return RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: bookingIds },
      requested_by: requestedBy,
      paid_reschedule: true,
      affects_reliability: true,
    },
    include: [
      {
        model: Payment,
        as: 'transaction',
        where: { payment_status: { [Op.in]: ['captured', 'partially_refunded'] } },
        required: true,
        attributes: [],
      },
    ],
  });
};

/** Sustained behavior claims only: upheld/partial decisions count; rejected does not. */
const sustainedBehaviorDecisionLiteral = () =>
  sequelize.literal(`disputes.decision IN ('upheld', 'partial')`);

/**
 * Calculate coach-specific raw split metrics (only bookings where user is the coach).
 * @param {number} userId
 * @param {{ windowDays: number, decayLambda: number }} cfg
 */
const calculateCoachRawSplits = async (userId, cfg) => {
  const now = new Date();
  const windowStart = getWindowStart(now, cfg.windowDays);
  const coachBookings = await Booking.findAll({
    where: { coach_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const coachBookingIds = coachBookings.map((b) => b.id);
  let recentBookings = 0;
  let decayedBookings = 0;
  for (const b of coachBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart, cfg.decayLambda);
    recentBookings += split.recent;
    decayedBookings += split.decayed;
  }

  if (coachBookingIds.length === 0) {
    return {
      booking_baseline_recent: 0,
      booking_baseline_decayed: 0,
      penalized_reschedules_recent: 0,
      penalized_reschedules_decayed: 0,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 0,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    };
  }

  const coachReschedules = await RescheduleHistory.findAll({
    where: {
      booking_id: { [Op.in]: coachBookingIds },
      requested_by: 'coach',
      affects_reliability: true,
    },
    attributes: ['id', 'requested_at'],
  });
  let penalized_reschedules = 0;
  let decayed_penalized_reschedules = 0;
  for (const r of coachReschedules) {
    const split = splitRecencyWeight(r.requested_at, now, windowStart, cfg.decayLambda);
    penalized_reschedules += split.recent;
    decayed_penalized_reschedules += split.decayed;
  }

  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: coachBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  let late_cancels = 0;
  let decayed_late_cancels = 0;
  let coach_cancels_non_late = 0;
  let decayed_coach_cancels_non_late = 0;
  for (const c of cancellations) {
    if (c.cancelled_by !== 'coach' || !c.affects_reliability) continue;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    const split = splitRecencyWeight(c.cancelled_at, now, windowStart, cfg.decayLambda);
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

  const lateArrivalDisputeType = await DisputeType.findOne({
    attributes: ['id'],
    where: { code: 'late_arrival', affects_reliability_score: true },
  });
  let late_arrival_penalties = 0;
  let decayed_late_arrival_penalties = 0;
  if (lateArrivalDisputeType && coachBookingIds.length) {
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: coachBookingIds } },
          { dispute_type_id: lateArrivalDisputeType.id },
          { penalize_role: 'coach' },
          { status: 'resolved' },
          sustainedBehaviorDecisionLiteral(),
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
      const split = splitRecencyWeight(at, now, windowStart, cfg.decayLambda);
      late_arrival_penalties += split.recent;
      decayed_late_arrival_penalties += split.decayed;
    }
  }

  const behaviorDisputeTypes = await DisputeType.findAll({
    attributes: ['id', 'code'],
    where: {
      code: { [Op.in]: ['misconduct', 'lesson_not_completed'] },
      affects_reliability_score: true,
    },
  });
  const behaviorDisputeTypeIds = Object.fromEntries(
    behaviorDisputeTypes.map((t) => [t.code, t.id]),
  );

  const countResolvedBehaviorPenalties = async (disputeTypeIds) => {
    const ids = (Array.isArray(disputeTypeIds) ? disputeTypeIds : [disputeTypeIds]).filter(Boolean);
    if (!ids.length) return { recent: 0, decayed: 0 };
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: coachBookingIds } },
          { dispute_type_id: { [Op.in]: ids } },
          { penalize_role: 'coach' },
          { status: 'resolved' },
          sustainedBehaviorDecisionLiteral(),
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
    let recent = 0;
    let decayed = 0;
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart, cfg.decayLambda);
      recent += split.recent;
      decayed += split.decayed;
    }
    return { recent, decayed };
  };
  const misconductPenaltiesAgg = await countResolvedBehaviorPenalties(
    behaviorDisputeTypeIds.misconduct,
  );
  const lessonNotCompletedPenaltiesAgg = await countResolvedBehaviorPenalties(
    behaviorDisputeTypeIds.lesson_not_completed,
  );

  let no_shows = 0;
  let decayed_no_shows = 0;
  const coachNoShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: coachBookingIds },
      status: 'coach_no_show',
    },
    attributes: ['scheduled_at'],
  });
  for (const b of coachNoShowBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart, cfg.decayLambda);
    no_shows += split.recent;
    decayed_no_shows += split.decayed;
  }

  const paidReschedules = await countPaidPenalizedCapturedReschedules(coachBookingIds, 'coach');

  return {
    booking_baseline_recent: recentBookings,
    booking_baseline_decayed: decayedBookings,
    penalized_reschedules_recent: penalized_reschedules,
    penalized_reschedules_decayed: decayed_penalized_reschedules,
    late_cancels_recent: late_cancels,
    late_cancels_decayed: decayed_late_cancels,
    coach_cancels_non_late_recent: coach_cancels_non_late,
    coach_cancels_non_late_decayed: decayed_coach_cancels_non_late,
    student_cancels_non_late_recent: 0,
    student_cancels_non_late_decayed: 0,
    no_shows_recent: no_shows,
    no_shows_decayed: decayed_no_shows,
    late_arrival_penalties_recent: late_arrival_penalties,
    late_arrival_penalties_decayed: decayed_late_arrival_penalties,
    misconduct_penalties_recent: misconductPenaltiesAgg.recent,
    misconduct_penalties_decayed: misconductPenaltiesAgg.decayed,
    lesson_not_completed_penalties_recent: lessonNotCompletedPenaltiesAgg.recent,
    lesson_not_completed_penalties_decayed: lessonNotCompletedPenaltiesAgg.decayed,
    paid_reschedules: paidReschedules,
  };
};

/**
 * Calculate student-specific raw split metrics (only bookings where user is primary student).
 */
const calculateStudentRawSplits = async (userId, cfg) => {
  const now = new Date();
  const windowStart = getWindowStart(now, cfg.windowDays);
  const studentBookings = await Booking.findAll({
    where: { primary_student_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const studentBookingIds = studentBookings.map((b) => b.id);
  let recentBookings = 0;
  let decayedBookings = 0;
  for (const b of studentBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart, cfg.decayLambda);
    recentBookings += split.recent;
    decayedBookings += split.decayed;
  }

  if (studentBookingIds.length === 0) {
    return {
      booking_baseline_recent: 0,
      booking_baseline_decayed: 0,
      penalized_reschedules_recent: 0,
      penalized_reschedules_decayed: 0,
      late_cancels_recent: 0,
      late_cancels_decayed: 0,
      coach_cancels_non_late_recent: 0,
      coach_cancels_non_late_decayed: 0,
      student_cancels_non_late_recent: 0,
      student_cancels_non_late_decayed: 0,
      no_shows_recent: 0,
      no_shows_decayed: 0,
      late_arrival_penalties_recent: 0,
      late_arrival_penalties_decayed: 0,
      misconduct_penalties_recent: 0,
      misconduct_penalties_decayed: 0,
      lesson_not_completed_penalties_recent: 0,
      lesson_not_completed_penalties_decayed: 0,
      paid_reschedules: 0,
    };
  }

  const studentReschedules = await RescheduleHistory.findAll({
    where: {
      booking_id: { [Op.in]: studentBookingIds },
      requested_by: 'student',
      affects_reliability: true,
    },
    attributes: ['requested_at'],
  });
  let reschedules = 0;
  let decayed_reschedules = 0;
  for (const r of studentReschedules) {
    const split = splitRecencyWeight(r.requested_at, now, windowStart, cfg.decayLambda);
    reschedules += split.recent;
    decayed_reschedules += split.decayed;
  }

  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: studentBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  let late_cancels = 0;
  let decayed_late_cancels = 0;
  let student_cancels = 0;
  let decayed_student_cancels = 0;
  for (const c of cancellations) {
    if (c.cancelled_by !== 'student' || !c.affects_reliability) continue;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    const split = splitRecencyWeight(c.cancelled_at, now, windowStart, cfg.decayLambda);
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

  const lateArrivalDisputeType = await DisputeType.findOne({
    attributes: ['id'],
    where: { code: 'late_arrival', affects_reliability_score: true },
  });
  let late_arrival_penalties = 0;
  let decayed_late_arrival_penalties = 0;
  if (lateArrivalDisputeType && studentBookingIds.length) {
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: studentBookingIds } },
          { dispute_type_id: lateArrivalDisputeType.id },
          { penalize_role: 'student' },
          { status: 'resolved' },
          sustainedBehaviorDecisionLiteral(),
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
      const split = splitRecencyWeight(at, now, windowStart, cfg.decayLambda);
      late_arrival_penalties += split.recent;
      decayed_late_arrival_penalties += split.decayed;
    }
  }

  const behaviorDisputeTypes = await DisputeType.findAll({
    attributes: ['id', 'code'],
    where: {
      code: { [Op.in]: ['misconduct', 'lesson_not_completed'] },
      affects_reliability_score: true,
    },
  });
  const behaviorDisputeTypeIds = Object.fromEntries(
    behaviorDisputeTypes.map((t) => [t.code, t.id]),
  );

  const countResolvedBehaviorPenalties = async (disputeTypeIds) => {
    const ids = (Array.isArray(disputeTypeIds) ? disputeTypeIds : [disputeTypeIds]).filter(Boolean);
    if (!ids.length) return { recent: 0, decayed: 0 };
    const rows = await Dispute.findAll({
      where: {
        [Op.and]: [
          { booking_id: { [Op.in]: studentBookingIds } },
          { dispute_type_id: { [Op.in]: ids } },
          { penalize_role: 'student' },
          { status: 'resolved' },
          sustainedBehaviorDecisionLiteral(),
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
    let recent = 0;
    let decayed = 0;
    for (const at of latestByBooking.values()) {
      const split = splitRecencyWeight(at, now, windowStart, cfg.decayLambda);
      recent += split.recent;
      decayed += split.decayed;
    }
    return { recent, decayed };
  };
  const misconductPenaltiesAgg = await countResolvedBehaviorPenalties(
    behaviorDisputeTypeIds.misconduct,
  );
  const lessonNotCompletedPenaltiesAgg = await countResolvedBehaviorPenalties(
    behaviorDisputeTypeIds.lesson_not_completed,
  );

  let no_shows = 0;
  let decayed_no_shows = 0;
  const explicitStudentNoShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: studentBookingIds },
      status: { [Op.in]: ['student_no_show'] },
    },
    attributes: ['scheduled_at'],
  });
  for (const b of explicitStudentNoShowBookings) {
    const split = splitRecencyWeight(b.scheduled_at, now, windowStart, cfg.decayLambda);
    no_shows += split.recent;
    decayed_no_shows += split.decayed;
  }

  return {
    booking_baseline_recent: recentBookings,
    booking_baseline_decayed: decayedBookings,
    penalized_reschedules_recent: reschedules,
    penalized_reschedules_decayed: decayed_reschedules,
    late_cancels_recent: late_cancels,
    late_cancels_decayed: decayed_late_cancels,
    coach_cancels_non_late_recent: 0,
    coach_cancels_non_late_decayed: 0,
    student_cancels_non_late_recent: student_cancels,
    student_cancels_non_late_decayed: decayed_student_cancels,
    no_shows_recent: no_shows,
    no_shows_decayed: decayed_no_shows,
    late_arrival_penalties_recent: late_arrival_penalties,
    late_arrival_penalties_decayed: decayed_late_arrival_penalties,
    misconduct_penalties_recent: misconductPenaltiesAgg.recent,
    misconduct_penalties_decayed: misconductPenaltiesAgg.decayed,
    lesson_not_completed_penalties_recent: lessonNotCompletedPenaltiesAgg.recent,
    lesson_not_completed_penalties_decayed: lessonNotCompletedPenaltiesAgg.decayed,
    paid_reschedules: await countPaidPenalizedCapturedReschedules(studentBookingIds, 'student'),
  };
};

/**
 * Update reliability for one role dimension (coach vs student).
 *
 * @param {number} userId
 * @param {'coach'|'student'} role
 * @param {{ skipIfAdminOverride?: boolean }} [options]
 *   - **skipIfAdminOverride** (default `false`): when `true`, periodic jobs skip rows with
 *     `score_source = admin_override`. Domain events (booking/dispute/payment paths) call with
 *     default `false` so the row is recomputed from source truth and `score_source` returns to `computed`.
 */
export const updateUserReliability = async (userId, role, options = {}) => {
  const { skipIfAdminOverride = false } = options;
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

  const cfg = getReliabilityConfig();
  const raw =
    role === 'coach'
      ? await calculateCoachRawSplits(userId, cfg)
      : await calculateStudentRawSplits(userId, cfg);

  let score = 100.0;
  let canonical = buildCanonicalReliabilityMetrics(raw, cfg);

  if (hasReliabilitySignal(raw)) {
    score = calculateReliabilityScoreFromCanonical(role, canonical);
  } else {
    canonical = buildCanonicalReliabilityMetrics(raw, cfg);
  }

  const persist = flattenCanonicalForPersistence(role, canonical, score, {
    scoreSource: 'computed',
    lastRecomputedAt: new Date(),
  });

  return sequelize.transaction(async (transaction) => {
    const existing = await UserReliability.findOne({
      where: { user_id: userId, role },
      transaction,
      lock: true,
    });

    if (skipIfAdminOverride && existing?.score_source === 'admin_override') {
      return existing;
    }

    if (!existing) {
      return UserReliability.create(
        { user_id: userId, role, ...persist },
        { transaction },
      );
    }

    await existing.update({ ...persist, user_id: userId, role }, { transaction });
    return existing;
  });
};
