import { useMemo } from 'react';
import { computeCoachReadiness } from '../domain/userReadiness.js';

/**
 * Memoized coach/student readiness from auth user + optional Stripe Connect status.
 * Pass `stripeConnectStatus` from GET /api/coaches/me/stripe-connect/status when available.
 *
 * @param {{ roles?: string[], coachProfile?: object | null } | null | undefined} user
 * @param {object | null | undefined} [stripeConnectStatus] — Stripe Connect status payload or undefined if not loaded
 */
export function useCoachReadiness(user, stripeConnectStatus) {
  return useMemo(
    () => computeCoachReadiness(user, stripeConnectStatus),
    [user, stripeConnectStatus],
  );
}
