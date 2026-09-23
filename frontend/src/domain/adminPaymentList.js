/**
 * Admin Payments list organization.
 *
 * tabs/groups (existing filters): All / Escrow held / Pending release /
 *   Payment failed / Refund activity
 * primary hierarchy (All): action/exception → in progress → settled → refunded/closed
 * secondary sort: updated_at DESC (fallback created_at DESC)
 * relevant timestamp: updated_at / created_at
 *
 * Does not invent payment states — only groups existing payment_status /
 * escrow_status / refund_status values.
 */

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function activityMs(p) {
  const updated = ms(p?.updated_at);
  if (Number.isFinite(updated)) return updated;
  const created = ms(p?.created_at);
  return Number.isFinite(created) ? created : 0;
}

/**
 * @returns {0|1|2|3}
 * 0 action/exception, 1 in progress, 2 settled, 3 refunded/closed
 */
export function adminPaymentLifecycleGroup(payment) {
  const pay = String(payment?.payment_status || '').toLowerCase();
  const escrow = String(payment?.escrow_status || '').toLowerCase();
  const refund = String(payment?.refund_status || 'none').toLowerCase();

  if (
    pay === 'failed'
    || escrow === 'disputed'
    || escrow === 'manual_payout_required'
    || refund === 'failed'
    || refund === 'pending'
  ) {
    return 0;
  }

  if (
    pay === 'refunded'
    || pay === 'partially_refunded'
    || escrow === 'refunded'
  ) {
    return 3;
  }

  if (
    pay === 'pending'
    || pay === 'authorized'
    || pay === 'pending_capture'
    || pay === 'pending_void'
    || escrow === 'pending'
    || escrow === 'held'
    || escrow === 'pending_release'
  ) {
    return 1;
  }

  // captured + released (or similar success) and other settled shapes
  return 2;
}

/**
 * @param {Array<object>} payments
 * @param {string} [filter] unused for grouping when set — still applies activity clock
 */
export function sortAdminPaymentsForList(payments, filter = '') {
  if (!Array.isArray(payments) || payments.length < 2) return payments || [];

  return [...payments].sort((a, b) => {
    if (!filter) {
      const ga = adminPaymentLifecycleGroup(a);
      const gb = adminPaymentLifecycleGroup(b);
      if (ga !== gb) return ga - gb;
    }
    return activityMs(b) - activityMs(a);
  });
}

export function adminPaymentsListHint(payments, filter = '') {
  const rows = Array.isArray(payments) ? payments : [];
  const n = rows.length;
  if (n === 0) return '';

  if (filter === 'escrow_held') {
    return `${n} escrow held · most recently updated first`;
  }
  if (filter === 'pending_release') {
    return `${n} pending release · most recently updated first`;
  }
  if (filter === 'payment_failed') {
    return `${n} failed · most recently updated first`;
  }
  if (filter === 'refund_issues') {
    return `${n} with refund activity · most recently updated first`;
  }

  const action = rows.filter((p) => adminPaymentLifecycleGroup(p) === 0).length;
  if (action) {
    return `Action/exception: ${action} · then in progress, settled, refunded/closed`;
  }
  return `${n} payment${n === 1 ? '' : 's'} · action → in progress → settled → refunded/closed`;
}
