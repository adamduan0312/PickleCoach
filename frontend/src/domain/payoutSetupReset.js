export const PAYOUT_SETUP_RESET_MESSAGE =
  'We couldn’t find the Stripe account linked to your profile, so your payout setup was reset. '
  + 'Set up payouts again to get listed on Discover.';

export function payoutSetupResetStorageKey(userId) {
  return `pc.payoutSetupReset.${userId}`;
}

/** Remembers a server-side reset until the coach is payout-ready again. */
export function nextPayoutSetupReset(previous, stripeStatus) {
  if (stripeStatus?.cleared_invalid_account) return true;
  if (stripeStatus?.stripe_ready) return false;
  return Boolean(previous);
}
