const STATUS_LABELS = {
  pending: 'Requested',
  confirmed: 'Confirmed',
  awaiting_verification: 'Awaiting confirmation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Payment dispute under review',
  student_no_show: 'Student no-show',
  coach_no_show: 'Coach no-show',
};

const STATUS_TONES = {
  pending: 'warning',
  confirmed: 'success',
  awaiting_verification: 'warning',
  completed: 'neutral',
  cancelled: 'danger',
  disputed: 'warning',
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

/** Open in-app report (`disputes` row) — distinct from Stripe `bookings.status = disputed`. */
export function hasOpenIssueReport(booking) {
  return Boolean(booking?.active_issue?.id);
}

export function bookingStatusLabel(status, { audience } = {}) {
  if (!status) return 'Unknown';
  if (status === 'pending' && audience === 'coach') return 'Response needed';
  if (status === 'awaiting_verification' && audience === 'coach') return 'Confirmation needed';
  if (status === 'awaiting_verification') return 'Awaiting confirmation';
  if (status === 'disputed') return 'Payment dispute under review';
  return STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}

/**
 * User-facing badge for a booking row.
 * In-app open report → "Issue reported"; Stripe chargeback (`disputed`) → "Payment dispute under review".
 */
export function bookingDisplayLabel(booking, { audience } = {}) {
  if (!booking) return 'Unknown';
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    return booking.status === 'disputed' && !hasOpenIssueReport(booking)
      ? 'Payment dispute under review'
      : 'Issue reported';
  }
  return bookingStatusLabel(booking.status, { audience });
}

export function bookingDisplayTone(booking) {
  if (!booking) return 'neutral';
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') return 'warning';
  return bookingStatusTone(booking.status);
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
  // failed / unknown: keep the label generic; paymentStatusLabel carries the status text.
  return null;
}

/**
 * Booking-detail amount row label.
 * Avoids awkward copy like "Amount (amount)" when payment failed / has no charge state.
 */
export function lessonAmountLabel(payment, booking) {
  const caption = payment ? paymentAmountCaption(payment) : null;
  if (caption === 'Authorized') return 'Amount authorized';
  if (caption === 'Charged') return 'Amount charged';
  if (caption === 'Refunded') return 'Amount refunded';
  if (caption === 'Partially refunded') return 'Amount partially refunded';
  if (booking?.status === 'pending') return 'Amount authorized';
  return 'Amount';
}

/**
 * True when payment fields confirm an uncaptured authorization or void-in-progress/released auth.
 * Do not treat bare `failed` as authorization release without supporting evidence.
 */
export function isUncapturedAuthorizationState(payment) {
  if (!payment) return false;
  const ps = String(payment.payment_status || '').toLowerCase();
  const escrow = String(payment.escrow_status || '').toLowerCase();
  if (isPaymentAuthorizedOnly(payment)) return true;
  if (ps === 'pending_void') return true;
  // After PI cancel webhook, voided authorizations often land as failed + released escrow.
  if (ps === 'failed' && escrow === 'released') return true;
  return false;
}

/** True when there is clearly no successful capture, without asserting an auth existed. */
export function isNoSuccessfulChargeState(payment) {
  if (!payment) return true;
  if (isUncapturedAuthorizationState(payment)) return false;
  const ps = String(payment.payment_status || '').toLowerCase();
  const rs = String(payment.refund_status || 'none').toLowerCase();
  return ps === 'failed' && rs === 'none';
}

/**
 * Coach-facing money interpretation after a coach-initiated cancellation.
 * Does not rewrite payment fields — returns display overrides only.
 *
 * Covers:
 * - authorize-only / voiding (before capture)
 * - failed with no successful charge (without claiming an auth existed)
 * - captured with refund still pending
 * - student refund completed
 *
 * @returns {null | {
 *   amountLabel: string,
 *   paymentStatusLine: string|null,
 *   payoutLabel: string,
 *   payoutKind: 'zero' | 'not_payable',
 * }}
 */
export function coachCancelMoneyPresentation(booking, payment) {
  if (!booking || booking.status !== 'cancelled') return null;
  if (booking.cancelled_by !== 'coach') return null;
  // If payout already moved, don't invent "not payable" over reality.
  if (isCoachPayoutReleased(booking)) return null;

  const ps = String(payment?.payment_status || '').toLowerCase();
  const rs = String(payment?.refund_status || 'none').toLowerCase();
  const refunded = isStudentPaymentRefunded(payment);
  const authOrVoiding = isUncapturedAuthorizationState(payment);
  const noSuccessfulCharge = isNoSuccessfulChargeState(payment);

  const historyRows = Array.isArray(booking.cancellationHistory) ? booking.cancellationHistory : [];
  const coachHistory =
    historyRows.find((row) => row?.cancelled_by === 'coach') || historyRows[0] || null;
  const historyRefundDue = Number(coachHistory?.refund_amount) > 0;
  const refundMarkedPending = rs === 'pending';
  const capturedAwaitingRefund =
    !refunded && ['captured', 'pending_capture', 'partially_refunded'].includes(ps);

  if (refunded) {
    return {
      amountLabel: 'Amount',
      paymentStatusLine: 'Student refunded',
      payoutLabel: 'Coach payout',
      payoutKind: 'zero',
    };
  }

  if (authOrVoiding) {
    const escrow = String(payment?.escrow_status || '').toLowerCase();
    let paymentStatusLine = 'Authorization released';
    if (ps === 'pending_void') {
      paymentStatusLine = 'Authorization releasing';
    } else if (isPaymentAuthorizedOnly(payment) && escrow !== 'released') {
      // Still authorized / void not confirmed yet — don't claim release.
      paymentStatusLine = paymentStatusLabel(payment) || 'Authorization releasing';
    }
    return {
      amountLabel: lessonAmountLabel(payment, booking),
      paymentStatusLine,
      payoutLabel: 'Coach payout',
      payoutKind: 'not_payable',
    };
  }

  if (noSuccessfulCharge) {
    return {
      amountLabel: 'Amount',
      paymentStatusLine: 'No successful charge was made',
      payoutLabel: 'Coach payout',
      payoutKind: 'not_payable',
    };
  }

  if (capturedAwaitingRefund || refundMarkedPending || historyRefundDue) {
    return {
      amountLabel: 'Amount',
      paymentStatusLine: 'Student refund pending',
      payoutLabel: 'Coach payout',
      payoutKind: 'not_payable',
    };
  }

  return {
    amountLabel: lessonAmountLabel(payment, booking),
    paymentStatusLine: paymentStatusLabel(payment),
    payoutLabel: 'Coach payout',
    payoutKind: 'not_payable',
  };
}

/**
 * Student-facing money interpretation after a coach-initiated cancellation.
 * Uses payment/refund fields + cancellation history — not cancelled status alone.
 *
 * @returns {null | {
 *   amountLabel: string,
 *   paymentStatusLine: string|null,
 *   showRefund: boolean,
 *   refundLabel: string,
 *   refundValueKind: 'text' | 'amount',
 *   refundValueText: string|null,
 *   refundValueAmount: number|null,
 *   refundStatusLine: string|null,
 *   lead: string,
 * }}
 */
export function studentCoachCancelMoneyPresentation(booking, payment) {
  if (!booking || booking.status !== 'cancelled') return null;
  if (booking.cancelled_by !== 'coach') return null;

  const ps = String(payment?.payment_status || '').toLowerCase();
  const rs = String(payment?.refund_status || 'none').toLowerCase();
  const escrow = String(payment?.escrow_status || '').toLowerCase();
  const refunded = isStudentPaymentRefunded(payment);
  const chargeAmount = Number(payment?.total_charge_to_student ?? booking.price);
  const refundedAmount = Number(payment?.refunded_amount);
  const historyRows = Array.isArray(booking.cancellationHistory) ? booking.cancellationHistory : [];
  const coachHistory =
    historyRows.find((row) => row?.cancelled_by === 'coach') || historyRows[0] || null;
  const historyRefundDue = Number(coachHistory?.refund_amount) > 0;
  const authOrVoiding = isUncapturedAuthorizationState(payment);
  const noSuccessfulCharge = isNoSuccessfulChargeState(payment);
  const capturedAwaitingRefund =
    !refunded && ['captured', 'pending_capture', 'partially_refunded'].includes(ps);
  const refundMarkedPending = rs === 'pending';
  const manualReview = escrow === 'manual_payout_required';

  if (refunded) {
    const amount = Number.isFinite(refundedAmount) && refundedAmount > 0
      ? refundedAmount
      : (Number.isFinite(chargeAmount) ? chargeAmount : null);
    return {
      amountLabel: 'Payment',
      paymentStatusLine: null,
      showRefund: true,
      refundLabel: 'Refund',
      refundValueKind: amount != null ? 'amount' : 'text',
      refundValueText: amount != null ? null : 'Full refund',
      refundValueAmount: amount,
      refundStatusLine: 'Refund completed',
      lead: 'The coach cancelled this booking. Your refund has been completed.',
    };
  }

  if (manualReview && !authOrVoiding && !noSuccessfulCharge) {
    return {
      amountLabel: 'Payment',
      paymentStatusLine: null,
      showRefund: true,
      refundLabel: 'Refund',
      refundValueKind: 'text',
      refundValueText: 'Full refund',
      refundValueAmount: null,
      refundStatusLine: 'Refund requires review. We’ll update you when it is resolved.',
      lead: 'The coach cancelled this booking. Your refund requires review.',
    };
  }

  if (authOrVoiding) {
    return {
      amountLabel: 'Payment',
      paymentStatusLine: null,
      showRefund: true,
      refundLabel: 'Refund',
      refundValueKind: 'text',
      refundValueText: 'No charge',
      refundValueAmount: null,
      refundStatusLine: 'Payment authorization released',
      lead: 'The coach cancelled this booking. No charge was made — your payment authorization was released.',
    };
  }

  if (noSuccessfulCharge) {
    return {
      amountLabel: 'Payment',
      paymentStatusLine: null,
      showRefund: true,
      refundLabel: 'Refund',
      refundValueKind: 'text',
      refundValueText: 'No charge',
      refundValueAmount: null,
      refundStatusLine: 'No successful charge was made',
      lead: 'The coach cancelled this booking. No successful charge was made.',
    };
  }

  if (capturedAwaitingRefund || refundMarkedPending || historyRefundDue) {
    return {
      amountLabel: 'Payment',
      paymentStatusLine: null,
      showRefund: true,
      refundLabel: 'Refund',
      refundValueKind: 'text',
      refundValueText: 'Full refund',
      refundValueAmount: null,
      refundStatusLine: 'Refund processing',
      lead: 'The coach cancelled this booking. Your refund is being processed.',
    };
  }

  return {
    amountLabel: 'Payment',
    paymentStatusLine: paymentStatusLabel(payment),
    showRefund: true,
    refundLabel: 'Refund',
    refundValueKind: 'text',
    refundValueText: 'Full refund',
    refundValueAmount: null,
    refundStatusLine: 'Refund processing',
    lead: 'The coach cancelled this booking. Your refund is being processed.',
  };
}

/** True when the student charge was fully or partially refunded. */
export function isStudentPaymentRefunded(payment) {
  if (!payment) return false;
  const ps = String(payment.payment_status || '').toLowerCase();
  if (ps === 'refunded' || ps === 'partially_refunded') return true;
  const rs = String(payment.refund_status || '').toLowerCase();
  return ['succeeded', 'complete', 'completed', 'full', 'partial'].includes(rs);
}

/** True when coach payout has been (or is being) sent. */
export function isCoachPayoutReleased(booking) {
  return ['processing', 'paid'].includes(String(booking?.payout_status || ''));
}

/**
 * True when no coach payout is due (full refund, forfeited payout, or $0 expected).
 * Partial refunds with retained balance remain payable — do not treat
 * `partially_refunded` alone as “none due.”
 */
export function isCoachPayoutNotDue(booking, payment) {
  if (isCoachPayoutReleased(booking)) return false;
  if (String(booking?.payout_status || '') === 'forfeited') return true;
  const ps = String(payment?.payment_status || '').toLowerCase();
  if (ps === 'refunded') return true;
  if (ps === 'partially_refunded') {
    if (payment?.coach_payout_expected != null && Number(payment.coach_payout_expected) === 0) {
      return true;
    }
    return false;
  }
  if (isStudentPaymentRefunded(payment)) return true;
  if (payment?.coach_payout_expected != null && Number(payment.coach_payout_expected) === 0) return true;
  return false;
}

/**
 * Pre-cancel money impact copy (matches paymentEngine.computeCancellationSplitCents).
 * Policy: uncaptured → release auth; early student cancel → full; late student (<24h) → ~half (floor);
 * coach cancel → full. Stripe remaining-balance cap is a processing safeguard, not a different policy.
 */
export function cancelMoneyConsequenceCopy(booking, payment, { audience } = {}) {
  if (!booking) return null;
  // Public booking DTO does not include charge_id. Use payment_status (and pending
  // booking status) so captured lessons don't still say "authorized only".
  const authorizedOnly = booking.status === 'pending' || isPaymentAuthorizedOnly(payment);

  if (booking.status === 'pending' || authorizedOnly) {
    return audience === 'coach'
      ? 'The student’s payment has only been authorized — they haven’t been charged. Cancelling releases the authorization.'
      : 'Your payment has only been authorized — you haven’t been charged. Cancelling releases the authorization.';
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
  // Policy: full refund when ≥24h before start (isLateCancel=false → refundCents = total).
  return 'You’ll receive a full refund of the captured lesson amount. The exact refund amount is calculated when the refund is processed.';
}

export function canStudentCancel(booking) {
  return booking && ['pending', 'confirmed'].includes(booking.status);
}

/** Coach cancel is for confirmed lessons — not pending requests (use decline). */
export function canCoachCancel(booking) {
  return booking && booking.status === 'confirmed';
}

/**
 * Upcoming soonest-first, then past most-recent-first (lesson date only).
 * @param {Array<{ scheduled_at?: string|Date }>} bookings
 * @param {number} [nowMs]
 */
export function sortBookingsUpcomingFirst(bookings, nowMs = Date.now()) {
  if (!Array.isArray(bookings) || bookings.length < 2) return bookings || [];
  const upcoming = [];
  const past = [];
  for (const b of bookings) {
    const t = new Date(b.scheduled_at).getTime();
    if (Number.isFinite(t) && t >= nowMs) upcoming.push(b);
    else past.push(b);
  }
  upcoming.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  past.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  return [...upcoming, ...past];
}

function lessonStartMs(booking) {
  const t = new Date(booking?.scheduled_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

const LIST_CANCELLED_GROUP = 4;

/**
 * Student My Bookings filters — simple lifecycle groups.
 * Card badges still show the exact booking-state label (including Issue reported).
 * No separate "Issues" category — open issues stay under the underlying lifecycle filter.
 */
export const STUDENT_BOOKING_LIST_FILTERS = [
  { value: '', label: 'All' },
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * Coach Bookings filters — Action needed = coach must respond / confirm / follow a case.
 * Reuses {@link coachBookingNeedsNavAttention} so the list tab matches the nav dot.
 */
export const COACH_BOOKING_LIST_FILTERS = [
  { value: '', label: 'All' },
  { value: 'action_needed', label: 'Action needed' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Student-side cancelled history (including declined / expired pending requests). */
function isStudentCancelledHistory(booking) {
  if (booking?.status !== 'cancelled') return false;
  if (booking?.cancelled_by === 'system') return true;
  if (booking?.declined_at || booking?.decline_reason_code) return true;
  return true;
}

/** True when a booking should appear under the selected list filter tab. */
export function bookingIncludedInListFilter(booking, filterStatus, { audience = 'student', now = Date.now() } = {}) {
  if (!filterStatus) return true;

  if (audience === 'coach') {
    switch (filterStatus) {
      // Legacy URL alias from the former "Needs attention" tab.
      case 'needs_attention':
      case 'action_needed':
        return coachBookingNeedsNavAttention(booking, now);
      case 'upcoming':
        return booking?.status === 'confirmed' && !hasLessonEnded(booking, now);
      case 'completed':
        return booking?.status === 'completed';
      case 'cancelled':
        return booking?.status === 'cancelled';
      default:
        return booking?.status === filterStatus;
    }
  }

  if (audience === 'student') {
    switch (filterStatus) {
      case 'awaiting_confirmation':
        return booking?.status === 'pending' || booking?.status === 'awaiting_verification';
      case 'upcoming':
        return booking?.status === 'confirmed' && !hasLessonEnded(booking, now);
      case 'completed':
        return booking?.status === 'completed';
      case 'cancelled':
        return isStudentCancelledHistory(booking);
      default:
        return booking?.status === filterStatus;
    }
  }

  return booking?.status === filterStatus;
}

/** Label for a list filter value (student or coach group keys). */
export function bookingListFilterLabel(filterStatus, { audience = 'student' } = {}) {
  if (!filterStatus) return 'All';
  const options = audience === 'coach' ? COACH_BOOKING_LIST_FILTERS : STUDENT_BOOKING_LIST_FILTERS;
  const hit = options.find((f) => f.value === filterStatus);
  if (hit) return hit.label;
  if (filterStatus === 'needs_attention') return 'Action needed';
  return bookingStatusLabel(filterStatus, { audience });
}

/**
 * Default “All” list order.
 *
 * Student: action required (pending, awaiting confirmation, open issues/disputes)
 *   → upcoming → completed/past → cancelled.
 * Coach: pending → awaiting_verification (confirmation) → upcoming → other past → cancelled.
 *
 * Within pending/upcoming: soonest lesson first.
 * Within awaiting/issues/past/cancelled: most recent lesson first (awaiting: oldest first).
 */
export function sortBookingsForList(bookings, nowMs = Date.now(), { audience = 'student' } = {}) {
  if (!Array.isArray(bookings) || bookings.length < 2) return bookings || [];

  function lifecycleGroup(booking) {
    const status = booking?.status;
    if (status === 'cancelled') return LIST_CANCELLED_GROUP;

    if (audience === 'student') {
      // Action required — student must wait on coach, confirm attendance, or follow an issue.
      if (
        status === 'pending'
        || status === 'awaiting_verification'
        || status === 'disputed'
        || hasOpenIssueReport(booking)
      ) {
        return 0;
      }
      if (status === 'confirmed' && !hasLessonEnded(booking, nowMs)) {
        return 1;
      }
      return 2; // completed / no-show / past confirmed
    }

    // Coach
    if (status === 'pending') return 0;

    if (status === 'awaiting_verification') {
      return 1;
    }

    const upcoming = lessonStartMs(booking) >= nowMs;
    if (upcoming) return 2;

    return 3;
  }

  function actionStatusRank(booking) {
    const status = booking?.status;
    if (status === 'pending') return 0;
    if (status === 'awaiting_verification') return 1;
    if (status === 'disputed' || hasOpenIssueReport(booking)) return 2;
    return 3;
  }

  function sortSoonestFirst(group, audienceMode) {
    if (audienceMode === 'coach') {
      return group === 0 || group === 2;
    }
    // Student: pending (within action) + upcoming soonest; awaiting/issues oldest below.
    return group === 1;
  }

  return [...bookings].sort((a, b) => {
    const ga = lifecycleGroup(a);
    const gb = lifecycleGroup(b);
    if (ga !== gb) return ga - gb;

    if (audience === 'student' && ga === 0) {
      const ra = actionStatusRank(a);
      const rb = actionStatusRank(b);
      if (ra !== rb) return ra - rb;
      const ta = lessonStartMs(a);
      const tb = lessonStartMs(b);
      // Pending: soonest first. Awaiting / issues: oldest outstanding first.
      if (ra === 0) return ta - tb;
      return ta - tb;
    }

    const ta = lessonStartMs(a);
    const tb = lessonStartMs(b);
    if (sortSoonestFirst(ga, audience)) return ta - tb;
    return tb - ta;
  });
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
 * Checkout-only policy (before payment). Do not reuse pending wait copy —
 * that assumes authorization already happened.
 */
export function checkoutAcceptancePolicyCopy(bookingLike = {}) {
  const n = coachAcceptanceTimeoutHours(bookingLike);
  const lead = minBookingLeadHours(bookingLike);
  const unit = n === 1 ? 'hour' : 'hours';
  const leadUnit = lead === 1 ? 'hour' : 'hours';
  if (lead <= 0) {
    return `The coach has ${n} ${unit} from this request to accept or decline.`;
  }
  return `The coach has up to ${n} ${unit} to accept, but must accept at least ${lead} ${leadUnit} before the lesson starts (whichever comes first).`;
}

/** Checkout — cancellation & no-show policy lines (student-facing, before commit). */
export function checkoutCancellationNoShowPolicyLines() {
  return [
    'Cancel 24+ hours before your lesson for a full refund.',
    'Cancellations within 24 hours may receive a 50% refund.',
    'If you don\'t show up for your lesson, your payment may not be refunded and your reliability score may be affected.',
  ];
}

/** Coach confirm dialog before POST .../student-no-show. */
export function studentNoShowConfirmTitle() {
  return 'Mark student as no-show?';
}

export function studentNoShowConfirmBody() {
  return 'If you mark this student as a no-show, the booking payment will not be automatically refunded and the student\'s reliability score may be affected.\n\nThis action can be reviewed if the student reports an issue.';
}

/** Subtle reminder on confirmed student bookings (what happens next). */
export const confirmedStudentNoShowReminder =
  'No-shows may affect your reliability score and may not be eligible for a refund.';

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
      return 'Your payment has only been authorized — you haven’t been charged. If the coach declines or doesn’t respond in time, the authorization is released.';
    }
    return 'Please accept or decline by the response deadline below. If you don’t respond in time, the request is cancelled automatically and the student’s payment authorization is released.';
  }

  if (audience === 'student') {
    if (lead <= 0) {
      return `Your payment has only been authorized — you haven’t been charged. The coach has ${n} ${unit} to accept or decline. If they decline or don’t respond, the authorization is released.`;
    }
    return `Your payment has only been authorized — you haven’t been charged. The coach has up to ${n} ${unit} to accept, but must accept at least ${lead} ${leadUnit} before the lesson (whichever comes first). If they decline or don’t respond in time, the authorization is released.`;
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
  if (hasOpenIssueReport(booking) || booking?.status === 'disputed') return false;
  return booking
    && ['confirmed', 'awaiting_verification'].includes(booking.status)
    && hasLessonEnded(booking, now);
}

export function canCoachMarkNoShow(booking, now = Date.now()) {
  if (hasOpenIssueReport(booking) || booking?.status === 'disputed') return false;
  return booking
    && ['confirmed', 'awaiting_verification'].includes(booking.status)
    && hasLessonEnded(booking, now);
}

/**
 * Coaches never open `student_no_show_claim` in the participant UI.
 * Use Mark Student no-show during the 24h post-lesson window instead.
 * Kept as an explicit gate so Report issue stays aligned with the API.
 */
export function coachCanReportStudentNoShowClaim(_booking, _now = Date.now()) {
  return false;
}

/** True when coach attendance actions must wait for dispute resolution. */
export function coachAttendanceBlockedByIssue(booking) {
  return hasOpenIssueReport(booking) || booking?.status === 'disputed';
}

/**
 * Client-side review-window check using `financial_review.review_until` so UI can
 * close the report form when the countdown ends without waiting for a refetch.
 * Falls back to server `window_open` when timestamps are missing.
 */
export function isFinancialReviewWindowOpen(booking, now = Date.now()) {
  const fr = booking?.financial_review;
  if (!fr) return false;
  if (fr.review_until) {
    const until = new Date(fr.review_until).getTime();
    if (!Number.isFinite(until)) return Boolean(fr.window_open);
    const endedAt = fr.lesson_ended_at ? new Date(fr.lesson_ended_at).getTime() : Number.NEGATIVE_INFINITY;
    const t = typeof now === 'number' ? now : new Date(now).getTime();
    return t >= endedAt && t < until;
  }
  return Boolean(fr.window_open);
}

export function canReportLessonIssue(booking, now = Date.now()) {
  if (!isFinancialReviewWindowOpen(booking, now)) return false;
  if (hasOpenIssueReport(booking)) return false;
  // Chargeback / disputed lifecycle — issue panel owns messaging; no new report form.
  if (booking.status === 'disputed') return false;
  if (!isPostLessonReviewEligible(booking, now)) return false;
  return ['confirmed', 'awaiting_verification', 'completed', 'student_no_show', 'coach_no_show'].includes(
    booking.status,
  );
}

/** Statuses where a lesson occurred or post-lesson attendance was recorded (excludes cancelled/pending). */
const POST_LESSON_REVIEW_ELIGIBLE_STATUSES = new Set([
  'awaiting_verification',
  'completed',
  'student_no_show',
  'coach_no_show',
  'disputed',
]);

/**
 * Post-lesson review window UI applies — lesson ended and booking is not a pre-lesson terminal state.
 * Guards against cancelled/expired requests showing review timers when scheduled_at is in the past.
 */
export function isPostLessonReviewEligible(booking, now = Date.now()) {
  if (!booking?.status) return false;
  if (booking.status === 'cancelled' || booking.status === 'pending') return false;
  if (!hasLessonEnded(booking, now)) return false;
  if (POST_LESSON_REVIEW_ELIGIBLE_STATUSES.has(booking.status)) return true;
  return booking.status === 'confirmed';
}

/** Student dashboard — only bookings where the student must take action. */
export function studentNeedsAttention(booking, now = Date.now()) {
  if (!booking?.status) return false;
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') return true;
  if (
    booking.status === 'student_no_show'
    && isPostLessonReviewEligible(booking, now)
    && isFinancialReviewWindowOpen(booking, now)
  ) {
    return true;
  }
  return false;
}

/** Alias for nav clarity — same semantics as {@link studentNeedsAttention}. */
export function studentBookingNeedsNavAttention(booking, now = Date.now()) {
  return studentNeedsAttention(booking, now);
}

/**
 * Coach Bookings nav attention — unresolved booking matters that need action,
 * verification, review, or follow-up (not merely that something happened).
 *
 * ON:
 * - pending (accept/decline)
 * - awaiting_verification with attendance actions available
 * - open issue report or disputed (follow the case)
 *
 * OFF: confirmed / completed / cancelled / declined / normal no-show with no coach action.
 * Visiting /coach/bookings does not clear this — underlying state must change.
 */
export function coachBookingNeedsNavAttention(booking, now = Date.now()) {
  if (!booking?.status) return false;
  if (booking.status === 'pending') return true;
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') return true;
  if (
    booking.status === 'awaiting_verification'
    && (canCoachComplete(booking, now) || canCoachMarkNoShow(booking, now))
  ) {
    return true;
  }
  return false;
}

/**
 * Whether any booking in a list should light the Bookings / My bookings nav dot.
 * @param {object[]} bookings
 * @param {'coach' | 'student'} audience
 * @param {number} [now]
 */
export function bookingsNeedNavAttention(bookings, audience, now = Date.now()) {
  const list = Array.isArray(bookings) ? bookings : [];
  if (audience === 'coach') {
    return list.some((b) => coachBookingNeedsNavAttention(b, now));
  }
  if (audience === 'student') {
    return list.some((b) => studentBookingNeedsNavAttention(b, now));
  }
  return false;
}

/** Student dashboard — past lessons for completed history. */
export function studentRecentLesson(booking, now = Date.now()) {
  if (!booking?.status) return false;
  if (booking.status === 'cancelled' || booking.status === 'pending') return false;
  if (!hasLessonEnded(booking, now)) return false;
  if (POST_LESSON_REVIEW_ELIGIBLE_STATUSES.has(booking.status)) return true;
  return booking.status === 'confirmed';
}

/** Short action-oriented line for student dashboard "Needs attention" links. */
export function studentNeedsAttentionSummary(booking, now = Date.now()) {
  if (!booking?.status) return 'View booking';
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') return 'Issue reported — view booking';
  if (booking.status === 'student_no_show') {
    return isFinancialReviewWindowOpen(booking, now)
      ? 'Issue-reporting window open — report if incorrect'
      : 'Student no-show';
  }
  return bookingStatusLabel(booking.status, { audience: 'student' });
}

/**
 * Student booking-detail banner copy for the post-lesson issue-reporting window.
 * Distinct from leaving a coach rating/review.
 */
export function studentReviewWindowBannerCopy(booking, { remaining, deadlineFormatted }, now = Date.now()) {
  if (studentNeedsAttention(booking, now)) {
    if (booking.status === 'student_no_show' && !hasOpenIssueReport(booking)) {
      return {
        tone: 'warning',
        title: 'Issue-reporting window open',
        body: `Report an issue if this no-show is incorrect. ${remaining} remaining (until ${deadlineFormatted}).`,
      };
    }
    if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
      return {
        tone: 'warning',
        title: 'Issue reported',
        body: 'Your report is under review. Payout is protected while this issue is being reviewed.',
      };
    }
  }
  if (booking.status === 'awaiting_verification') {
    return {
      tone: 'info',
      title: 'Issue-reporting window open',
      body: `Your lesson time has passed. The coach still needs to confirm attendance. If something went wrong, you can report an issue within 24 hours of the lesson (${remaining} remaining, until ${deadlineFormatted}).`,
    };
  }
  return {
    tone: 'info',
    title: 'Issue-reporting window open',
    body: `Your lesson is complete. If something went wrong, you can report an issue within 24 hours of the lesson (${remaining} remaining, until ${deadlineFormatted}).`,
  };
}

/** Short cancelled-booking outcome for history rows and detail lead. */
export function cancelledOutcomeCopy(booking, { audience, payment } = {}) {
  if (!booking || booking.status !== 'cancelled') return null;
  const by = booking.cancelled_by;
  if (by === 'system') {
    if (audience === 'coach') {
      return 'You didn’t respond before the deadline. The student’s payment authorization was released.';
    }
    return 'The coach didn’t respond before the deadline. The payment authorization was released.';
  }
  if (by === 'coach') {
    if (booking.declined_at || booking.decline_reason_code) {
      if (audience === 'coach') {
        return 'You declined this booking. The student’s payment authorization has been released.';
      }
      return 'The coach declined this booking. The payment authorization was released.';
    }
    if (audience === 'coach') {
      return 'You cancelled this lesson. The student’s payment will be refunded according to the cancellation policy.';
    }
    if (audience === 'student') {
      const money = studentCoachCancelMoneyPresentation(booking, payment);
      if (money?.lead) return money.lead;
      return 'The coach cancelled this booking.';
    }
    return 'The coach cancelled. If payment had been captured, a full refund applies.';
  }
  if (by === 'student') {
    if (audience === 'student') {
      return 'You cancelled this lesson. Refunds follow the cancellation timing rules that applied when you cancelled.';
    }
    return 'The student cancelled this booking. Refunds follow the cancellation timing rules.';
  }
  if (by === 'admin') {
    return 'An administrator cancelled this booking.';
  }
  return 'This booking was cancelled.';
}

/** Short outcome copy for terminal / no-show / dispute states. */
export function bookingOutcomeCopy(booking, { audience, now = Date.now(), payment = null } = {}) {
  if (!booking?.status) return null;
  if (booking.status === 'cancelled') return cancelledOutcomeCopy(booking, { audience, payment });
  if (booking.status === 'student_no_show') {
    if (audience === 'coach') {
      return isFinancialReviewWindowOpen(booking, now)
        ? 'Student no-show recorded. There is no student refund. Your payout follows the normal post-lesson review window if no issue is reported.'
        : 'Student no-show recorded. There is no student refund. The review period has ended.';
    }
    const resolved = booking?.resolved_issue;
    if (resolved?.id) {
      const penalize = String(resolved.penalize_role || 'none').toLowerCase();
      if (penalize === 'none' || !penalize) {
        return 'No refund was issued. No reliability penalty was applied.';
      }
      if (penalize === 'student') {
        return 'No refund was issued. A reliability penalty was applied.';
      }
    }
    return isFinancialReviewWindowOpen(booking, now)
      ? 'The coach reported that you did not attend. Your payment was not automatically refunded, and this may affect your reliability score.'
      : 'The coach reported that you did not attend. Your payment was not automatically refunded, and this may affect your reliability score. The issue-reporting window has ended.';
  }
  if (booking.status === 'coach_no_show') {
    if (audience === 'student') {
      return isFinancialReviewWindowOpen(booking, now)
        ? 'Your coach did not attend this lesson. After the issue-reporting period, you may receive a full refund of the remaining captured amount unless an open issue is still being resolved.'
        : 'Your coach did not attend this lesson. The issue-reporting period has ended; refund settlement follows the normal process unless an open issue remains.';
    }
    // Neutral final-state copy — do not imply who marked the no-show (admin / upheld claim / overturn).
    return 'This booking was resolved as a coach no-show. No payout is due.';
  }
  if (booking.status === 'disputed' || hasOpenIssueReport(booking)) {
    return 'Your report is under review. Payout is protected while this issue is being reviewed.';
  }
  return null;
}


/**
 * Booking-detail note when messaging cannot be started / continued.
 * Pending is special (not yet open); other locked statuses are closed after the active window.
 */
export function messagingLockedCopy(booking) {
  if (!booking?.messaging_locked) return null;
  if (booking.status === 'pending') {
    return 'Messaging opens after the coach accepts this booking.';
  }
  if (booking.conversation?.id) {
    return 'This conversation is closed. You can still view previous messages.';
  }
  return 'Messaging is closed for this booking.';
}

/**
 * Conversation-thread notice when send is locked (history remains readable).
 */
export function conversationClosedNotice(booking) {
  if (!booking?.messaging_locked) return null;
  if (booking.status === 'pending') {
    return 'Messaging opens after the coach accepts this booking.';
  }
  if (booking.status === 'completed') {
    return 'This conversation is closed. You can view your previous messages, but you can’t send new messages for this completed booking.';
  }
  if (booking.status === 'cancelled') {
    return 'This conversation is closed. You can view your previous messages, but you can’t send new messages for this cancelled booking.';
  }
  if (booking.status === 'coach_no_show' || booking.status === 'student_no_show') {
    return 'This conversation is closed. You can view your previous messages, but you can’t send new messages for this booking.';
  }
  if (booking.status === 'disputed') {
    return 'This conversation is closed. You can view your previous messages, but you can’t send new messages while this payment dispute is open.';
  }
  return 'This conversation is closed. You can view your previous messages, but you can’t send new messages for this booking.';
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

/** Human label for a cancellation reason code; null when unknown/empty. */
export function cancelReasonLabel(reason) {
  if (!reason) return null;
  return CANCEL_REASONS.find((r) => r.value === reason)?.label || null;
}

/**
 * Audience-aware headline for a cancellation_history row.
 * Uses “You …” when the viewer initiated the cancel; otherwise third person.
 */
export function cancellationHistoryEventLabel(row, { audience } = {}) {
  const by = row?.cancelled_by;
  if (by === 'system') return 'This booking was cancelled automatically';
  if (by === 'admin') return 'An administrator cancelled this booking';
  if (by === 'coach') {
    return audience === 'coach' ? 'You cancelled this booking' : 'Coach cancelled this booking';
  }
  if (by === 'student') {
    return audience === 'student' ? 'You cancelled this booking' : 'Student cancelled this booking';
  }
  return 'This booking was cancelled';
}

/**
 * Customer-facing reason for a cancellation_history row.
 * Prefer readable enum labels; for `other`/missing codes, use reason_notes when present.
 * Never returns raw role/reason codes.
 *
 * @returns {{ primary: string, detail: string|null }|null}
 */
export function cancellationHistoryReasonDisplay(row) {
  const notes = typeof row?.reason_notes === 'string' ? row.reason_notes.trim() : '';
  const code = row?.reason || null;
  const label = cancelReasonLabel(code);

  if (code && code !== 'other' && label) {
    const detail = notes && notes.toLowerCase() !== label.toLowerCase() ? notes : null;
    return { primary: label, detail };
  }
  if (notes) return { primary: notes, detail: null };
  if (label) return { primary: label, detail: null };
  return null;
}

export const DECLINE_REASON_CODES = [
  { value: 'availability_conflict', label: 'Schedule conflict' },
  { value: 'sickness', label: 'Sickness' },
  { value: 'weather', label: 'Weather' },
  { value: 'outside_service_area', label: 'Outside service area' },
  { value: 'lesson_not_fit', label: 'Lesson not a good fit' },
  { value: 'other', label: 'Other' },
];
