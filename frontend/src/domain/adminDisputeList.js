/**
 * Admin Disputes list organization.
 *
 * tabs/groups: Open (open+under_review) / Resolved / All
 * primary hierarchy: action required (open → under_review) → closed (resolved → rejected)
 * secondary sort: open band → opened_at ASC (oldest first);
 *                 closed → resolved_at DESC (fallback opened_at DESC)
 * relevant timestamp: opened_at / resolved_at
 *
 * Dispute status ≠ booking status ≠ financial/reliability outcome.
 */

const ACTION_RANK = {
  open: 0,
  under_review: 1,
};

const CLOSED_RANK = {
  resolved: 0,
  rejected: 1,
};

export function isOpenDisputeStatus(status) {
  return status === 'open' || status === 'under_review';
}

export function adminDisputeLifecycleGroup(dispute) {
  return isOpenDisputeStatus(dispute?.status) ? 0 : 1;
}

function ms(value) {
  if (value == null || value === '') return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function openedAtMs(d) {
  const t = ms(d?.opened_at);
  return Number.isFinite(t) ? t : 0;
}

function resolvedAtMs(d) {
  const t = ms(d?.resolved_at);
  if (Number.isFinite(t)) return t;
  return openedAtMs(d);
}

function compareOpen(a, b) {
  const ra = ACTION_RANK[a?.status] ?? 99;
  const rb = ACTION_RANK[b?.status] ?? 99;
  if (ra !== rb) return ra - rb;
  return openedAtMs(a) - openedAtMs(b);
}

function compareClosed(a, b) {
  const ra = CLOSED_RANK[a?.status] ?? 99;
  const rb = CLOSED_RANK[b?.status] ?? 99;
  if (ra !== rb) return ra - rb;
  return resolvedAtMs(b) - resolvedAtMs(a);
}

/**
 * @param {Array<object>} disputes
 * @param {'open'|'resolved'|'all'|string} [filter]
 */
export function sortAdminDisputesForList(disputes, filter = 'open') {
  if (!Array.isArray(disputes) || disputes.length < 2) return disputes || [];

  return [...disputes].sort((a, b) => {
    if (filter === 'all') {
      const ga = adminDisputeLifecycleGroup(a);
      const gb = adminDisputeLifecycleGroup(b);
      if (ga !== gb) return ga - gb;
      return ga === 0 ? compareOpen(a, b) : compareClosed(a, b);
    }
    if (filter === 'open') return compareOpen(a, b);
    return compareClosed(a, b);
  });
}

export function adminDisputesListHint(disputes, filter = 'open') {
  const rows = Array.isArray(disputes) ? disputes : [];
  const n = rows.length;
  if (n === 0) return '';

  if (filter === 'open') {
    return `${n} open/under review · oldest unresolved first`;
  }
  if (filter === 'resolved') {
    return `${n} closed · most recently resolved first`;
  }
  const open = rows.filter((d) => isOpenDisputeStatus(d.status)).length;
  const closed = n - open;
  return `Action required: ${open} · closed: ${closed} · open cases oldest first`;
}
