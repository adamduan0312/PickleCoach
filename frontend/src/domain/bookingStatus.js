const STATUS_LABELS = {
  pending: 'Booking requested',
  confirmed: 'Confirmed',
  awaiting_verification: 'Lesson ended — confirm attendance',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Payment disputed',
  student_no_show: 'Student no-show',
  coach_no_show: 'Coach no-show',
};

const STATUS_TONES = {
  pending: 'warning',
  confirmed: 'success',
  awaiting_verification: 'info',
  completed: 'neutral',
  cancelled: 'danger',
  disputed: 'danger',
  student_no_show: 'danger',
  coach_no_show: 'danger',
};

const PAYMENT_LABELS = {
  pending: 'Payment pending',
  authorized: 'Payment authorized (not charged yet)',
  pending_capture: 'Payment authorized (not charged yet)',
  captured: 'Payment captured',
  failed: 'Payment failed',
  refunded: 'Payment refunded',
  partially_refunded: 'Partially refunded',
  pending_void: 'Authorization releasing',
};

export function bookingStatusLabel(status, { audience } = {}) {
  if (!status) return 'Unknown';
  if (status === 'awaiting_verification') {
    return audience === 'coach'
      ? 'Lesson ended — confirm attendance'
      : 'Waiting for coach to confirm attendance';
  }
  if (status === 'pending' && audience === 'coach') return 'Response needed';
  return STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}

export function bookingStatusTone(status) {
  return STATUS_TONES[status] || 'neutral';
}

export function paymentStatusLabel(payment) {
  if (!payment) return null;
  if (payment.refund_status && ['succeeded', 'complete', 'completed', 'full'].includes(String(payment.refund_status).toLowerCase())) {
    return 'Payment refunded';
  }
  if (payment.payment_status && PAYMENT_LABELS[payment.payment_status]) {
    return PAYMENT_LABELS[payment.payment_status];
  }
  return null;
}

/** True when funds were authorized but not yet captured. */
export function isPaymentAuthorizedOnly(payment) {
  if (!payment) return false;
  const s = String(payment.payment_status || '');
  return s === 'authorized' || s === 'pending_capture' || s === 'pending';
}

/** Student-facing amount line — never say "charged" before capture. */
export function paymentAmountCaption(payment) {
  if (!payment || payment.total_charge_to_student == null) return null;
  const s = String(payment.payment_status || '');
  if (s === 'refunded') return 'Refunded';
  if (s === 'partially_refunded') return 'Partially refunded';
  if (s === 'captured') return 'Charged';
  if (isPaymentAuthorizedOnly(payment) || s === 'pending_void') return 'Authorized';
  return 'Amount';
}

/**
 * Pre-cancel money impact copy (matches paymentEngine.computeCancellationSplitCents).
 * Policy: uncaptured → release auth; early student cancel → full; late student (<24h) → ~half (floor);
 * coach cancel → full. Stripe remaining-balance cap is a processing safeguard, not a different policy.
 */
export function cancelMoneyConsequenceCopy(booking, payment, { audience } = {}) {
  if (!booking) return null;
  const authorizedOnly = isPaymentAuthorizedOnly(payment)
    || booking.status === 'pending'
    || !payment?.charge_id;

  if (booking.status === 'pending' || authorizedOnly) {
    return audience === 'coach'
      ? 'The student’s payment authorization will be released. They won’t be charged.'
      : 'Your payment authorization will be released. You won’t be charged.';
  }

  if (booking.status !== 'confirmed') return null;

  const start = booking.scheduled_at ? new Date(booking.scheduled_at).getTime() : NaN;
  const hoursUntil = Number.isFinite(start) ? (start - Date.now()) / (1000 * 60 * 60) : null;
  const isLate = hoursUntil != null && hoursUntil >= 0 && hoursUntil < 24;

  if (audience === 'coach') {
    return 'Cancelling refunds the student in full under the cancellation policy. Your payout for this lesson will not proceed.';
  }

  if (isLate) {
    return 'Late cancellation: a refund of approximately half of the lesson amount may apply. The exact refund amount is calculated when the refund is processed.';
  }
  return 'You’ll receive a full refund of the captured payment under the cancellation policy.';
}

export function canStudentCancel(booking) {
  return booking && ['pending', 'confirmed'].includes(booking.status);
}

export function canCoachAccept(booking) {
  return booking && booking.status === 'pending';
}

export function canCoachDecline(booking) {
  return booking && booking.status === 'pending';
}

export function coachAcceptanceTimeoutHours(booking) {
  const n = Number(booking?.coach_acceptance_timeout_hours);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 24;
}

export function minBookingLeadHours(booking) {
  const n = Number(booking?.min_booking_lead_hours);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 2;
}

/** Concrete acceptance deadline ISO from booking DTO, if present. */
export function coachAcceptanceDeadlineAt(booking) {
  return booking?.coach_acceptance_deadline_at || null;
}

/**
 * Pending-request guidance. Prefer the concrete deadline when the API provides it.
 */
export function pendingRequestTimeoutCopy(booking, { audience } = {}) {
  const deadlineIso = coachAcceptanceDeadlineAt(booking);
  const n = coachAcceptanceTimeoutHours(booking);
  const lead = minBookingLeadHours(booking);
  const unit = n === 1 ? 'hour' : 'hours';
  const leadUnit = lead === 1 ? 'hour' : 'hours';

  if (deadlineIso) {
    if (audience === 'student') {
      return 'The coach must accept or decline by the response deadline below. If they don’t respond in time, the request is cancelled and your payment authorization is released.';
    }
    return 'Please accept or decline by the response deadline below. If you don’t respond in time, the request is cancelled automatically and the student’s payment authorization is released.';
  }

  if (audience === 'student') {
    if (lead <= 0) {
      return `The coach has ${n} ${unit} from this request to accept or decline. If they don’t respond, the request is cancelled automatically and your payment authorization is released.`;
    }
    return `The coach has up to ${n} ${unit} to accept, but must accept at least ${lead} ${leadUnit} before the lesson starts (whichever comes first). If they don’t respond in time, the request is cancelled and your payment authorization is released.`;
  }
  if (lead <= 0) {
    return `Please accept or decline this request in PickleCoach within ${n} ${unit} of this request. If you don’t respond, the request is cancelled automatically and the student’s payment authorization is released.`;
  }
  return `Please accept or decline within ${n} ${unit} of this request, and at least ${lead} ${leadUnit} before the lesson starts (whichever comes first). If you don’t respond in time, the request is cancelled and the student’s payment authorization is released.`;
}

/** Lesson end has passed (attendance actions become available). */
export function hasLessonEnded(booking, now = Date.now()) {
  if (!booking?.scheduled_at) return false;
  if (booking.financial_review?.lesson_ended_at) {
    const t = new Date(booking.financial_review.lesson_ended_at).getTime();
    if (Number.isFinite(t)) return now >= t;
  }
  const start = new Date(booking.scheduled_at).getTime();
  if (!Number.isFinite(start)) return false;
  const durationMs = (Number(booking.duration_minutes) || 0) * 60 * 1000;
  return now >= start + durationMs;
}

export function canCoachComplete(booking, now = Date.now()) {
  return booking
    && ['confirmed', 'awaiting_verification'].includes(booking.status)
    && hasLessonEnded(booking, now);
}

export function canCoachMarkNoShow(booking, now = Date.now()) {
  return booking
    && ['confirmed', 'awaiting_verification'].includes(booking.status)
    && hasLessonEnded(booking, now);
}

export function canReportLessonIssue(booking) {
  if (!booking?.financial_review?.window_open) return false;
  return ['confirmed', 'awaiting_verification', 'completed', 'student_no_show', 'coach_no_show', 'disputed'].includes(
    booking.status,
  );
}

/** Short cancelled-booking outcome for history rows. */
export function cancelledOutcomeCopy(booking) {
  if (!booking || booking.status !== 'cancelled') return null;
  const by = booking.cancelled_by;
  if (by === 'system') {
    return 'The coach didn’t respond before the deadline. The payment authorization was released.';
  }
  if (by === 'coach') {
    if (booking.declined_at || booking.decline_reason_code) {
      return 'The coach declined this request. The payment authorization was released.';
    }
    return 'The coach cancelled. If payment had been captured, a full refund applies.';
  }
  if (by === 'student') {
    return 'You cancelled this booking. Refunds follow the cancellation timing rules that applied when you cancelled.';
  }
  if (by === 'admin') {
    return 'An administrator cancelled this booking.';
  }
  return null;
}

/** Short outcome copy for terminal / no-show / dispute states. */
export function bookingOutcomeCopy(booking, { audience } = {}) {
  if (!booking?.status) return null;
  if (booking.status === 'cancelled') return cancelledOutcomeCopy(booking);
  if (booking.status === 'student_no_show') {
    return audience === 'coach'
      ? 'Student no-show recorded. There is no student refund. Your payout follows the normal post-lesson review window if no issue is reported.'
      : 'You were marked as a no-show. There is no refund for this lesson. You can report a problem during the review window if something is wrong.';
  }
  if (booking.status === 'coach_no_show') {
    return audience === 'student'
      ? 'If your coach doesn’t show up, you’ll receive a full refund of the remaining captured lesson amount after the review window. If you have an open dispute, the refund may be handled through the dispute process instead.'
      : 'Coach no-show recorded. After the review window, the student is refunded the remaining captured lesson amount (ordinarily the full charge if nothing was refunded earlier), unless an open dispute routes the outcome through dispute resolution. This affects your reliability score.';
  }
  if (booking.status === 'disputed') {
    return 'A payment or lesson issue was reported. Payout stays protected until the dispute is resolved.';
  }
  return null;
}


export function messagingLockedCopy(booking) {
  if (!booking?.messaging_locked) return null;
  if (booking.status === 'pending') {
    return 'Messaging opens after the coach accepts this booking.';
  }
  return 'Messaging is closed for this booking.';
}

export const CANCEL_REASONS = [
  { value: 'weather', label: 'Weather' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'sickness', label: 'Sickness' },
  { value: 'travel_delay', label: 'Travel delay' },
  { value: 'schedule_conflict', label: 'Schedule conflict' },
  { value: 'forgot', label: 'Forgot' },
  { value: 'other', label: 'Other' },
];

export const DECLINE_REASON_CODES = [
  { value: 'availability_conflict', label: 'Schedule conflict' },
  { value: 'sickness', label: 'Sickness' },
  { value: 'weather', label: 'Weather' },
  { value: 'outside_service_area', label: 'Outside service area' },
  { value: 'lesson_not_fit', label: 'Lesson not a good fit' },
  { value: 'other', label: 'Other' },
];
