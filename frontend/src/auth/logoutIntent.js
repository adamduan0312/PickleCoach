/**
 * Distinguishes intentional logout from session expiry / auth guard bounces.
 *
 * Logout clears the session while React is still on a protected route; RequireAuth
 * would otherwise treat that as "interrupted navigation" and set authRedirect+from.
 * Mark intentional logout before clearSession so the login page does not resume
 * the previous user's URL.
 */

let intentionalLogout = false;

export function markIntentionalLogout() {
  intentionalLogout = true;
}

export function isIntentionalLogout() {
  return intentionalLogout;
}

/** Call when /login mounts (or after a clean logout navigate) so later 401 bounces can resume. */
export function clearIntentionalLogout() {
  intentionalLogout = false;
}
