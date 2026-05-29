/**
 * Canonical in-app dispute lifecycle (`disputes.status`).
 *
 * - **In-app disputes** (`POST /api/disputes`): created `open`; resolved only via
 *   `PUT /api/disputes/:id/resolve` → `resolved`.
 * - **Stripe chargebacks** (`syncStripeDisputeToDatabase`): Stripe is source of truth;
 *   `STRIPE_SYNC` allows mirroring to `open` | `under_review` | `resolved` without a rigid
 *   per-edge matrix so webhook replays stay safe.
 *
 * `decision` / `outcome` / financial fields are **not** part of this status enum — they live
 * on the dispute row and are validated by `disputeResolutionAlignment.js`.
 */

export const DISPUTE_STATUSES = Object.freeze(['open', 'under_review', 'resolved', 'rejected']);

export const ACTIVE_DISPUTE_STATUSES = Object.freeze(['open', 'under_review']);

export const DisputeTransitionVia = Object.freeze({
  /** Student/coach/admin `POST /api/disputes` */
  IN_APP_CREATE: 'in_app_create',
  /** Admin `PUT /api/disputes/:id/resolve` */
  ADMIN_RESOLVE: 'admin_resolve',
  /** `syncStripeDisputeToDatabase` */
  STRIPE_SYNC: 'stripe_sync',
});

/**
 * @param {string | null | undefined} status
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function assertInitialInAppDisputeStatus(status) {
  if (status !== 'open') {
    return {
      ok: false,
      code: 'dispute_initial_status_invalid',
      message: `New in-app disputes must start as "open" (got "${status}").`,
    };
  }
  return { ok: true };
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} via
 * @returns {{ ok: true, noop?: boolean } | { ok: false, code: string, message: string }}
 */
export function canTransitionDisputeStatus(from, to, via) {
  if (from === to) {
    if (via === DisputeTransitionVia.ADMIN_RESOLVE) {
      if (to !== 'resolved') {
        return {
          ok: false,
          code: 'dispute_admin_resolve_requires_resolved',
          message: `Admin resolve must set disputes.status to "resolved" (got "${to}").`,
        };
      }
      return { ok: true, noop: true };
    }
    if (via === DisputeTransitionVia.STRIPE_SYNC) {
      return { ok: true, noop: true };
    }
    return { ok: true, noop: true };
  }
  if (!DISPUTE_STATUSES.includes(to)) {
    return {
      ok: false,
      code: 'dispute_unknown_target_status',
      message: `Invalid dispute status "${to}".`,
    };
  }

  if (via === DisputeTransitionVia.STRIPE_SYNC) {
    if (from != null && !DISPUTE_STATUSES.includes(from)) {
      return {
        ok: false,
        code: 'dispute_unknown_source_status',
        message: `Invalid prior dispute status "${from}".`,
      };
    }
    return { ok: true };
  }

  if (via === DisputeTransitionVia.IN_APP_CREATE) {
    if (to !== 'open') {
      return {
        ok: false,
        code: 'dispute_create_invalid_status',
        message: 'In-app create must set status to open.',
      };
    }
    return { ok: true };
  }

  if (via === DisputeTransitionVia.ADMIN_RESOLVE) {
    if (to !== 'resolved') {
      return {
        ok: false,
        code: 'dispute_admin_resolve_requires_resolved',
        message: `Admin resolve must set disputes.status to "resolved" (got "${to}").`,
      };
    }
    if (from !== 'open' && from !== 'under_review') {
      return {
        ok: false,
        code: 'dispute_not_resolvable',
        message: `Dispute cannot be resolved from status "${from}" (expected open or under_review).`,
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    code: 'dispute_transition_unknown_via',
    message: `Unknown dispute transition channel "${via}".`,
  };
}

/**
 * @param {import('../models/Dispute.js').default} dispute
 * @param {{ toStatus: string, via: string, patch?: Record<string, unknown>, options?: import('sequelize').UpdateOptions }} p
 */
export async function applyDisputeStatusTransition(dispute, { toStatus, via, patch = {}, options = {} }) {
  const from = dispute.status;
  const check = canTransitionDisputeStatus(from, toStatus, via);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code;
    err.statusCode = 400;
    throw err;
  }
  if (check.noop) {
    if (Object.keys(patch).length > 0) {
      await dispute.update(patch, options);
    }
    return dispute;
  }
  const payload = { ...patch, status: toStatus };
  await dispute.update(payload, options);
  dispute.status = toStatus;
  return dispute;
}
