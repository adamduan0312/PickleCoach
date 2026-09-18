/**
 * Short role-specific “how bookings work” copy for first-login / Settings reopen.
 * Keep plain language — no escrow, workers, or DB status names.
 */

export const STUDENT_GUIDE = {
  title: 'How bookings work',
  highlight:
    'After the lesson, check your booking. If something went wrong, report an issue before the review window closes.',
  steps: [
    'When you book, your card is authorized — you are not charged until the coach accepts.',
    'The coach must accept in time, or the authorization is released.',
    'Show up for your lesson. No-shows may affect your reliability and may not be refunded.',
    'After the lesson, you have about 24 hours to report a problem before payment is normally finalized.',
  ],
};

export const COACH_GUIDE = {
  title: 'How bookings work',
  highlight:
    'After the lesson, record what happened: mark Complete if it happened, or Student no-show if the student did not attend. This records attendance; it does not determine your payout.',
  steps: [
    'Respond to booking requests before the deadline, or the student’s authorization is released.',
    'Show up and teach at the scheduled time.',
    'After the lesson, mark Complete or Student no-show so attendance is on record.',
    'Payout follows the review window and any reported issues — not the Complete / No-show click alone.',
  ],
};

export function guideForRole(role) {
  if (role === 'coach') return COACH_GUIDE;
  if (role === 'student') return STUDENT_GUIDE;
  return null;
}
