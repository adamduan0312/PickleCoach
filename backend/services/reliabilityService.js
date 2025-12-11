import { UserReliability, Booking, RescheduleHistory, CancellationHistory } from '../models/index.js';
import { Op } from 'sequelize';

const calculateReliabilityScore = (metrics) => {
  const {
    total_bookings,
    reschedules,
    paid_reschedules,
    late_cancels,
    no_shows,
    coach_cancels,
  } = metrics;

  if (total_bookings === 0) return 100.00;

  let score = 100.00;

  // Deduct points for negative behaviors
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

export const updateUserReliability = async (userId) => {
  const bookings = await Booking.findAll({
    where: {
      [Op.or]: [
        { coach_id: userId },
        { primary_student_id: userId },
      ],
    },
  });

  const reschedules = await RescheduleHistory.count({
    include: [{
      model: Booking,
      as: 'booking',
      where: {
        [Op.or]: [
          { coach_id: userId },
          { primary_student_id: userId },
        ],
      },
    }],
  });

  const cancellations = await CancellationHistory.findAll({
    include: [{
      model: Booking,
      as: 'booking',
      where: {
        [Op.or]: [
          { coach_id: userId },
          { primary_student_id: userId },
        ],
      },
    }],
  });

  const metrics = {
    total_bookings: bookings.length,
    reschedules,
    paid_reschedules: 0, // TODO: Calculate from reschedule history
    late_cancels: cancellations.filter(c => {
      const hoursBefore = (new Date(c.booking.scheduled_at) - new Date(c.cancelled_at)) / (1000 * 60 * 60);
      return hoursBefore < 24;
    }).length,
    no_shows: 0, // TODO: Calculate from disputes or booking status
    coach_cancels: cancellations.filter(c => c.cancelled_by === 'coach').length,
  };

  const reliability_score = calculateReliabilityScore(metrics);

  const [reliability, created] = await UserReliability.findOrCreate({
    where: { user_id: userId },
    defaults: { ...metrics, reliability_score },
  });

  if (!created) {
    await reliability.update({ ...metrics, reliability_score });
  }

  return reliability;
};
