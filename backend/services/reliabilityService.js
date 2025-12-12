import { UserReliability, Booking, RescheduleHistory, CancellationHistory, User } from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Calculate reliability score for COACHES
 * Penalizes: coach cancellations, reschedules, no-shows
 */
const calculateCoachReliabilityScore = (metrics) => {
  const {
    total_bookings,
    reschedules,
    late_cancels,
    no_shows,
    coach_cancels,
  } = metrics;

  if (total_bookings === 0) return 100.00;

  let score = 100.00;

  // Deduct points for negative behaviors specific to coaches
  const reschedulePenalty = (reschedules / total_bookings) * 20;
  const lateCancelPenalty = (late_cancels / total_bookings) * 30;
  const noShowPenalty = (no_shows / total_bookings) * 50;
  const coachCancelPenalty = (coach_cancels / total_bookings) * 25;

  score -= reschedulePenalty;
  score -= lateCancelPenalty;
  score -= noShowPenalty;
  score -= coachCancelPenalty;

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate reliability score for STUDENTS
 * Penalizes: student reschedules, late cancellations, no-shows, student cancellations
 */
const calculateStudentReliabilityScore = (metrics) => {
  const {
    total_bookings,
    reschedules,
    late_cancels,
    no_shows,
    student_cancels,
  } = metrics;

  if (total_bookings === 0) return 100.00;

  let score = 100.00;

  // Penalize behaviors that students control
  const reschedulePenalty = (reschedules / total_bookings) * 20;
  const lateCancelPenalty = (late_cancels / total_bookings) * 30;
  const noShowPenalty = (no_shows / total_bookings) * 50;
  const studentCancelPenalty = (student_cancels / total_bookings) * 25;

  score -= reschedulePenalty;
  score -= lateCancelPenalty;
  score -= noShowPenalty;
  score -= studentCancelPenalty;

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate coach-specific reliability metrics
 * Only counts bookings where user is the coach
 */
const calculateCoachMetrics = async (userId) => {
  // Get bookings where user is the COACH
  const coachBookings = await Booking.findAll({
    where: { coach_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const coachBookingIds = coachBookings.map(b => b.id);

  if (coachBookingIds.length === 0) {
    return {
      total_bookings: 0,
      reschedules: 0,
      paid_reschedules: 0,
      late_cancels: 0,
      no_shows: 0,
      coach_cancels: 0,
    };
  }

  // Count reschedules requested by the coach
  const reschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: coachBookingIds },
      requested_by: 'coach',
    },
  });

  // Get cancellations for coach bookings
  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: coachBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  // Count late cancellations (within 24 hours) where coach cancelled
  const late_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'coach') return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    return hoursBefore < 24;
  }).length;

  // Count coach cancellations
  const coach_cancels = cancellations.filter(c => c.cancelled_by === 'coach').length;

  // TODO: Calculate no-shows (could check disputes or booking status)
  const no_shows = 0;

  return {
    total_bookings: coachBookings.length,
    reschedules,
    paid_reschedules: 0, // TODO: Calculate from reschedule history
    late_cancels,
    no_shows,
    coach_cancels,
  };
};

/**
 * Calculate student-specific reliability metrics
 * Only counts bookings where user is the student
 */
const calculateStudentMetrics = async (userId) => {
  // Get bookings where user is the STUDENT
  const studentBookings = await Booking.findAll({
    where: { primary_student_id: userId },
    attributes: ['id', 'scheduled_at'],
  });
  const studentBookingIds = studentBookings.map(b => b.id);

  if (studentBookingIds.length === 0) {
    return {
      total_bookings: 0,
      reschedules: 0,
      late_cancels: 0,
      no_shows: 0,
      student_cancels: 0,
    };
  }

  // Count reschedules requested by the student
  const reschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: studentBookingIds },
      requested_by: 'student',
    },
  });

  // Get cancellations for student bookings
  const cancellations = await CancellationHistory.findAll({
    where: { booking_id: { [Op.in]: studentBookingIds } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['scheduled_at'],
    }],
  });

  // Count late cancellations (within 24 hours) where STUDENT cancelled
  const late_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'student') return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    return hoursBefore < 24;
  }).length;

  // Count all student cancellations
  const student_cancels = cancellations.filter(c => c.cancelled_by === 'student').length;

  // TODO: Calculate no-shows (could check disputes or booking status)
  const no_shows = 0;

  return {
    total_bookings: studentBookings.length,
    reschedules,
    late_cancels,
    no_shows,
    student_cancels,
  };
};

/**
 * Update reliability scores for a user
 * Calculates separate scores for coach and student roles
 */
export const updateUserReliability = async (userId) => {
  // Get user to determine their role
  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  let coachMetrics = { total_bookings: 0, reschedules: 0, paid_reschedules: 0, late_cancels: 0, no_shows: 0, coach_cancels: 0 };
  let studentMetrics = { total_bookings: 0, reschedules: 0, late_cancels: 0, no_shows: 0, student_cancels: 0 };
  let coachScore = 100.00;
  let studentScore = 100.00;

  // Calculate reliability based on user's role
  if (user.role === 'coach' || user.role === 'admin') {
    coachMetrics = await calculateCoachMetrics(userId);
    if (coachMetrics.total_bookings > 0) {
      coachScore = calculateCoachReliabilityScore(coachMetrics);
    }
  }

  if (user.role === 'student' || user.role === 'admin') {
    studentMetrics = await calculateStudentMetrics(userId);
    if (studentMetrics.total_bookings > 0) {
      studentScore = calculateStudentReliabilityScore(studentMetrics);
    }
  }

  // Update or create reliability record
  const [reliability, created] = await UserReliability.findOrCreate({
    where: { user_id: userId },
    defaults: {
      user_id: userId,
      total_bookings: coachMetrics.total_bookings + studentMetrics.total_bookings,
      reschedules: coachMetrics.reschedules,
      paid_reschedules: coachMetrics.paid_reschedules,
      late_cancels: coachMetrics.late_cancels + studentMetrics.late_cancels,
      no_shows: coachMetrics.no_shows + studentMetrics.no_shows,
      coach_cancels: coachMetrics.coach_cancels,
      coach_reliability_score: coachScore,
      student_reliability_score: studentScore,
    },
  });

  if (!created) {
    await reliability.update({
      total_bookings: coachMetrics.total_bookings + studentMetrics.total_bookings,
      reschedules: coachMetrics.reschedules,
      paid_reschedules: coachMetrics.paid_reschedules,
      late_cancels: coachMetrics.late_cancels + studentMetrics.late_cancels,
      no_shows: coachMetrics.no_shows + studentMetrics.no_shows,
      coach_cancels: coachMetrics.coach_cancels,
      coach_reliability_score: coachScore,
      student_reliability_score: studentScore,
    });
  }

  return reliability;
};
