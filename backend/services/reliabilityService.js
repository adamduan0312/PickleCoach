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
import {
  getReliabilityConfig,
  RELIABILITY_WINDOW_DAYS,
  RELIABILITY_DECAY_LAMBDA,
  calculateCoachReliabilityScore,
  calculateStudentReliabilityScore,
} from './reliabilityScoring.js';

export { getReliabilityConfig };

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
const hasReliabilitySignal = (m) =>
  (Number(m?.total_bookings) || 0) > 0 || (Number(m?._booking_baseline) || 0) > 0;

/** Sustained behavior claims only: upheld/partial decisions count; rejected does not. */
const sustainedBehaviorDecisionLiteral = () =>
  sequelize.literal(`disputes.decision IN ('upheld', 'partial')`);

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
      late_arrival_penalties: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
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
      const split = splitRecencyWeight(at, now, windowStart);
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

  /** Sustained behavior disputes (`penalize_role` targeting this party); dedupe = latest per booking. */
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
      const split = splitRecencyWeight(at, now, windowStart);
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

  // No-shows are status-driven only (explicit final attendance outcomes).
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
      late_arrival_penalties: decayed_late_arrival_penalties,
      misconduct_penalties: misconductPenaltiesAgg.decayed,
      lesson_not_completed_penalties: lessonNotCompletedPenaltiesAgg.decayed,
      no_shows: decayed_no_shows,
      coach_cancels: decayed_coach_cancels_non_late,
    },
    // Persist under existing schema key; semantic meaning is penalized-only.
    reschedules: penalized_reschedules,
    paid_reschedules: paidReschedules,
    late_cancels,
    late_arrival_penalties,
    misconduct_penalties: misconductPenaltiesAgg.recent,
    lesson_not_completed_penalties: lessonNotCompletedPenaltiesAgg.recent,
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
      late_arrival_penalties: 0,
      misconduct_penalties: 0,
      lesson_not_completed_penalties: 0,
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
      const split = splitRecencyWeight(at, now, windowStart);
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
      const split = splitRecencyWeight(at, now, windowStart);
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

  // No-shows are status-driven only (explicit final attendance outcomes).
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
      late_arrival_penalties: decayed_late_arrival_penalties,
      misconduct_penalties: misconductPenaltiesAgg.decayed,
      lesson_not_completed_penalties: lessonNotCompletedPenaltiesAgg.decayed,
      no_shows: decayed_no_shows,
      student_cancels: decayed_student_cancels,
    },
    reschedules,
    late_cancels,
    late_arrival_penalties,
    misconduct_penalties: misconductPenaltiesAgg.recent,
    lesson_not_completed_penalties: lessonNotCompletedPenaltiesAgg.recent,
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
    late_arrival_penalties: 0,
    misconduct_penalties: 0,
    lesson_not_completed_penalties: 0,
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
      late_arrival_penalties: metrics.late_arrival_penalties,
      misconduct_penalties: metrics.misconduct_penalties || 0,
      lesson_not_completed_penalties: metrics.lesson_not_completed_penalties || 0,
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
      late_arrival_penalties: metrics.late_arrival_penalties,
      misconduct_penalties: metrics.misconduct_penalties || 0,
      lesson_not_completed_penalties: metrics.lesson_not_completed_penalties || 0,
      no_shows: metrics.no_shows,
      coach_cancels: metrics.coach_cancels || 0,
      reliability_score: score,
    });
  }

  return reliability;
};