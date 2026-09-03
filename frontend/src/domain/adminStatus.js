import {
  bookingStatusLabel,
  bookingStatusTone,
  hasOpenIssueReport,
} from './bookingStatus.js';

function titleCaseSnake(value) {
  if (value == null || value === '') return '—';
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const PAYMENT_SHORT = {
  pending: 'Pending',
  authorized: 'Authorized',
  pending_capture: 'Authorized',
  pending_void: 'Releasing auth',
  captured: 'Captured',
  failed: 'Failed',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
};

const ESCROW_SHORT = {
  pending: 'Pending',
  held: 'Held',
  pending_release: 'Pending release',
  released: 'Released',
  refunded: 'Refunded',
  disputed: 'Disputed',
  manual_payout_required: 'Manual payout required',
};

const PAYOUT_SHORT = {
  none: 'Not released',
  pending: 'Pending',
  awaiting_verification: 'Awaiting verification',
  processing: 'Processing',
  paid: 'Paid',
  forfeited: 'Forfeited',
};

const REFUND_SHORT = {
  none: 'None',
  pending: 'Pending',
  succeeded: 'Succeeded',
  complete: 'Succeeded',
  completed: 'Succeeded',
  full: 'Succeeded',
  failed: 'Failed',
  partial: 'Partial',
};

const DISPUTE_SHORT = {
  open: 'Open',
  under_review: 'Under review',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

/**
 * Admin booking status — always the raw booking lifecycle, never “Issue reported”.
 */
export function adminBookingStatusView(booking) {
  const status = booking?.status;
  return {
    key: 'booking',
    label: 'Booking',
    value: bookingStatusLabel(status),
    tone: bookingStatusTone(status),
  };
}

/**
 * In-app issue report — distinct from Stripe bookings.status = disputed.
 */
export function adminIssueStatusView(booking) {
  if (hasOpenIssueReport(booking)) {
    return {
      key: 'issue',
      label: 'Issue',
      value: 'Issue reported',
      tone: 'warning',
    };
  }
  return {
    key: 'issue',
    label: 'Issue',
    value: 'None',
    tone: 'neutral',
  };
}

export function adminPaymentStatusView(payment) {
  if (!payment) {
    return { key: 'payment', label: 'Payment', value: 'None', tone: 'neutral' };
  }
  const raw = String(payment.payment_status || '');
  const value = PAYMENT_SHORT[raw] || titleCaseSnake(raw) || 'Unknown';
  let tone = 'neutral';
  if (raw === 'captured') tone = 'success';
  else if (raw === 'failed') tone = 'danger';
  else if (raw === 'refunded' || raw === 'partially_refunded') tone = 'warning';
  else if (raw === 'authorized' || raw === 'pending_capture' || raw === 'pending') tone = 'info';
  return { key: 'payment', label: 'Payment', value, tone };
}

export function adminEscrowStatusView(payment) {
  if (!payment) {
    return { key: 'escrow', label: 'Escrow', value: 'None', tone: 'neutral' };
  }
  const raw = String(payment.escrow_status || '');
  const value = ESCROW_SHORT[raw] || titleCaseSnake(raw) || 'Unknown';
  let tone = 'neutral';
  if (raw === 'held' || raw === 'pending_release') tone = 'warning';
  else if (raw === 'released') tone = 'success';
  else if (raw === 'refunded' || raw === 'disputed' || raw === 'manual_payout_required') tone = 'danger';
  else if (raw === 'pending') tone = 'info';
  return { key: 'escrow', label: 'Escrow', value, tone };
}

/** Coach payout from booking.payout_status — never confuse with student charge. */
export function adminPayoutStatusView(booking) {
  const raw = String(booking?.payout_status || 'none');
  const value = PAYOUT_SHORT[raw] || titleCaseSnake(raw) || 'Unknown';
  let tone = 'neutral';
  if (raw === 'paid') tone = 'success';
  else if (raw === 'processing' || raw === 'pending' || raw === 'awaiting_verification') tone = 'info';
  else if (raw === 'forfeited') tone = 'danger';
  return { key: 'payout', label: 'Payout', value, tone };
}

/**
 * Payout label for payment inventory rows.
 * Prefer booking.payout_status when present; otherwise derive from escrow/transfer — never from charge_id.
 */
export function adminPayoutViewForPaymentRow(payment) {
  const booking = payment?.booking;
  if (booking?.payout_status) return adminPayoutStatusView(booking);
  if (payment?.transfer_id) {
    return { key: 'payout', label: 'Payout', value: 'Transfer created', tone: 'info' };
  }
  const escrow = String(payment?.escrow_status || '');
  if (escrow === 'released') {
    return { key: 'payout', label: 'Payout', value: 'Released', tone: 'success' };
  }
  if (escrow === 'held' || escrow === 'pending_release' || escrow === 'refunded') {
    return { key: 'payout', label: 'Payout', value: 'Not released', tone: 'neutral' };
  }
  return { key: 'payout', label: 'Payout', value: 'None', tone: 'neutral' };
}

export function adminRefundStatusView(payment) {
  if (!payment) {
    return { key: 'refund', label: 'Refund', value: 'None', tone: 'neutral' };
  }
  const raw = String(payment.refund_status || 'none').toLowerCase();
  const value = REFUND_SHORT[raw] || titleCaseSnake(raw) || 'Unknown';
  let tone = 'neutral';
  if (raw === 'none') tone = 'neutral';
  else if (raw === 'pending') tone = 'info';
  else if (['succeeded', 'complete', 'completed', 'full', 'partial'].includes(raw)) tone = 'warning';
  else if (raw === 'failed') tone = 'danger';
  return { key: 'refund', label: 'Refund', value, tone };
}

export function adminDisputeStatusView(dispute) {
  const raw = String(dispute?.status || '');
  const value = DISPUTE_SHORT[raw] || titleCaseSnake(raw) || 'Unknown';
  let tone = 'neutral';
  if (raw === 'open' || raw === 'under_review') tone = 'warning';
  else if (raw === 'resolved') tone = 'success';
  else if (raw === 'rejected') tone = 'neutral';
  return { key: 'dispute', label: 'Dispute', value, tone };
}

export function adminAccountStatusView(user) {
  if (user?.deleted_at) {
    return { key: 'account', label: 'Account', value: 'Deleted', tone: 'danger' };
  }
  if (user?.is_active === false) {
    return { key: 'account', label: 'Account', value: 'Suspended', tone: 'danger' };
  }
  return { key: 'account', label: 'Account', value: 'Active', tone: 'success' };
}

/**
 * Explicit multi-state stack for a booking (+ optional payment).
 * Booking and Issue are always separate rows.
 */
export function adminBookingMoneyStatusItems({ booking, payment } = {}) {
  return [
    adminBookingStatusView(booking),
    adminIssueStatusView(booking),
    adminPaymentStatusView(payment),
    adminEscrowStatusView(payment),
    adminPayoutStatusView(booking),
  ];
}

export function formatAdminRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return '—';
  return roles.map((r) => titleCaseSnake(r)).join(', ');
}

export function formatReliabilityPercent(summary) {
  if (!summary || summary.reliability_score == null) return null;
  const n = Number(summary.reliability_score);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)}%`;
}

export function disputeAgeLabel(openedAt, now = Date.now()) {
  if (!openedAt) return '—';
  const t = new Date(openedAt).getTime();
  if (!Number.isFinite(t)) return '—';
  const ms = Math.max(0, now - t);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
