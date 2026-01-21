import { UserReliability, Booking, RescheduleHistory, CancellationHistory, User, Dispute, DisputeType } from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Calculate reliability score for COACHES
 * Only penalizes events where affects_reliability = true
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
  // Only count penalized events (affects_reliability = true)
  const reschedulePenalty = (reschedules / total_bookings) * 10;
  const lateCancelPenalty = (late_cancels / total_bookings) * 15;
  const noShowPenalty = (no_shows / total_bookings) * 35;
  const coachCancelPenalty = (coach_cancels / total_bookings) * 20;

  score -= reschedulePenalty;
  score -= lateCancelPenalty;
  score -= noShowPenalty;
  score -= coachCancelPenalty;

  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate reliability score for STUDENTS
 * Only penalizes events where affects_reliability = true
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
  // Only count penalized events (affects_reliability = true)
  const reschedulePenalty = (reschedules / total_bookings) * 8;
  const lateCancelPenalty = (late_cancels / total_bookings) * 15;
  const noShowPenalty = (no_shows / total_bookings) * 12;
  const studentCancelPenalty = (student_cancels / total_bookings) * 12;

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

  // Count reschedules requested by the coach where affects_reliability = true
  const reschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: coachBookingIds },
      requested_by: 'coach',
      affects_reliability: true, // Only count penalized reschedules
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

  // Count late cancellations (within 24 hours BEFORE scheduled time) where coach cancelled and affects_reliability = true
  const late_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'coach' || !c.affects_reliability) return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    // Only count cancellations that occurred BEFORE the scheduled time (hoursBefore >= 0) and within 24 hours
    return hoursBefore >= 0 && hoursBefore < 24;
  }).length;

  // Count coach cancellations where affects_reliability = true, excluding late cancellations to avoid double-penalization
  const coach_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'coach' || !c.affects_reliability) return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    // Exclude late cancellations (within 24 hours) - they are penalized separately
    return hoursBefore < 0 || hoursBefore >= 24;
  }).length;

  // Calculate no-shows: bookings that were scheduled but never completed or cancelled
  // A no-show is a booking that:
  // 1. Has status 'confirmed' or 'awaiting_verification'
  // 2. Scheduled time has passed (more than 2 hours ago)
  // 3. Has a dispute opened for 'no_show' type, OR booking was never completed/cancelled
  const noShowDisputeType = await DisputeType.findOne({ where: { code: 'no_show' } });
  
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  
  const noShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: coachBookingIds },
      status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
      scheduled_at: { [Op.lt]: twoHoursAgo },
    },
  });
  
  let no_shows = 0;
  for (const booking of noShowBookings) {
    // Check if there's a no-show dispute
    if (noShowDisputeType) {
      const noShowDispute = await Dispute.findOne({
        where: {
          booking_id: booking.id,
          dispute_type_id: noShowDisputeType.id,
        },
      });
      if (noShowDispute) {
        no_shows++;
        continue;
      }
    }
    // If no dispute, check if booking was never completed or cancelled
    // (This is a conservative approach - only count if clearly a no-show)
    const hasCancellation = await CancellationHistory.findOne({
      where: { booking_id: booking.id },
    });
    if (!hasCancellation && booking.status !== 'completed') {
      // Likely a no-show, but be conservative - only count if past scheduled time significantly
      const hoursPastScheduled = (now - new Date(booking.scheduled_at)) / (1000 * 60 * 60);
      if (hoursPastScheduled > 24) {
        no_shows++;
      }
    }
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
    total_bookings: coachBookings.length,
    reschedules,
    paid_reschedules: paidReschedules,
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

  // Count reschedules requested by the student where affects_reliability = true
  const reschedules = await RescheduleHistory.count({
    where: {
      booking_id: { [Op.in]: studentBookingIds },
      requested_by: 'student',
      affects_reliability: true, // Only count penalized reschedules
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

  // Count late cancellations (within 24 hours BEFORE scheduled time) where STUDENT cancelled and affects_reliability = true
  const late_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'student' || !c.affects_reliability) return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    // Only count cancellations that occurred BEFORE the scheduled time (hoursBefore >= 0) and within 24 hours
    return hoursBefore >= 0 && hoursBefore < 24;
  }).length;

  // Count student cancellations where affects_reliability = true, excluding late cancellations to avoid double-penalization
  const student_cancels = cancellations.filter(c => {
    if (c.cancelled_by !== 'student' || !c.affects_reliability) return false;
    const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
    // Exclude late cancellations (within 24 hours) - they are penalized separately
    return hoursBefore < 0 || hoursBefore >= 24;
  }).length;

  // Calculate no-shows: bookings that were scheduled but never completed or cancelled
  const noShowDisputeType = await DisputeType.findOne({ where: { code: 'no_show' } });
  
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  
  const noShowBookings = await Booking.findAll({
    where: {
      id: { [Op.in]: studentBookingIds },
      status: { [Op.in]: ['confirmed', 'awaiting_verification'] },
      scheduled_at: { [Op.lt]: twoHoursAgo },
    },
  });
  
  let no_shows = 0;
  for (const booking of noShowBookings) {
    // Check if there's a no-show dispute
    if (noShowDisputeType) {
      const noShowDispute = await Dispute.findOne({
        where: {
          booking_id: booking.id,
          dispute_type_id: noShowDisputeType.id,
        },
      });
      if (noShowDispute) {
        no_shows++;
        continue;
      }
    }
    // If no dispute, check if booking was never completed or cancelled
    const hasCancellation = await CancellationHistory.findOne({
      where: { booking_id: booking.id },
    });
    if (!hasCancellation && booking.status !== 'completed') {
      // Likely a no-show, but be conservative
      const hoursPastScheduled = (now - new Date(booking.scheduled_at)) / (1000 * 60 * 60);
      if (hoursPastScheduled > 24) {
        no_shows++;
      }
    }
  }

  return {
    total_bookings: studentBookings.length,
    reschedules,
    late_cancels,
    no_shows,
    student_cancels,
  };
};

/**
 * Update reliability score for a user
 * Calculates a single reliability_score based on user's primary role
 * Only counts events where affects_reliability = true
 * Admins are excluded from reliability calculations
 */
export const updateUserReliability = async (userId) => {
  // Get user to determine their role
  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  // Admins do NOT participate in marketplace reliability
  // They are observers and intervenors, not participants
  if (user.role === 'admin') {
    return null;
  }

  let metrics = { total_bookings: 0, reschedules: 0, paid_reschedules: 0, late_cancels: 0, no_shows: 0, coach_cancels: 0, student_cancels: 0 };
  let score = 100.00;

  // Only process coaches and students
  // Note: Reliability is role-specific - coaches track coach reschedules, students track student reschedules
  // The 'reschedules' field in user_reliability stores reschedules for the user's specific role
  if (user.role === 'coach') {
    const coachMetrics = await calculateCoachMetrics(userId);
    // For coaches: reschedules = coach reschedules only
    metrics = { ...coachMetrics, student_cancels: 0 };
    if (coachMetrics.total_bookings > 0) {
      score = calculateCoachReliabilityScore(coachMetrics);
    }
  } else if (user.role === 'student') {
    const studentMetrics = await calculateStudentMetrics(userId);
    // For students: reschedules = student reschedules only
    metrics = { ...studentMetrics, coach_cancels: 0, paid_reschedules: 0 };
    if (studentMetrics.total_bookings > 0) {
      score = calculateStudentReliabilityScore(studentMetrics);
    }
  } else {
    // Unexpected role - should not happen
    throw new Error(`Cannot calculate reliability for role: ${user.role}`);
  }

  // Update or create reliability record
  // Note: 'reschedules' field stores role-specific reschedules (coach reschedules for coaches, student reschedules for students)
  const [reliability, created] = await UserReliability.findOrCreate({
    where: { user_id: userId },
    defaults: {
      user_id: userId,
      total_bookings: metrics.total_bookings,
      reschedules: metrics.reschedules, // Role-specific: coach reschedules for coaches, student reschedules for students
      paid_reschedules: metrics.paid_reschedules || 0,
      late_cancels: metrics.late_cancels,
      no_shows: metrics.no_shows,
      coach_cancels: metrics.coach_cancels || 0,
      reliability_score: score,
    },
  });

  if (!created) {
    await reliability.update({
      total_bookings: metrics.total_bookings,
      reschedules: metrics.reschedules, // Role-specific: coach reschedules for coaches, student reschedules for students
      paid_reschedules: metrics.paid_reschedules || 0,
      late_cancels: metrics.late_cancels,
      no_shows: metrics.no_shows,
      coach_cancels: metrics.coach_cancels || 0,
      reliability_score: score,
    });
  }

  return reliability;
};