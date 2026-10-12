/**
 * Fake Connect account ids written by local seed scripts to simulate a coach whose payouts are set up.
 * Outside production they skip live Stripe sync (so seeded coaches stay listed via DB `stripe_ready`) and
 * never receive transfers. In production they're treated like any other unknown id: invalid and cleared.
 *
 * Keep in sync with seed scripts. Do **not** add `acct_restored_*` — those are intentionally cleared as invalid.
 */
const DEV_SEED_CONNECT_PREFIXES = [
  'acct_testflow_',
  'acct_seed_',
  'acct_davie_',
  'acct_pinecrest_',
  'acct_rating_',
  'acct_diverse_',
  'acct_tour_',
];

export function isDevSeedStripeConnectAccountId(accountId) {
  if (process.env.NODE_ENV === 'production') return false;
  const id = String(accountId || '');
  return DEV_SEED_CONNECT_PREFIXES.some((prefix) => id.startsWith(prefix));
}
