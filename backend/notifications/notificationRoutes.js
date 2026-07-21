/**
 * Client deep-link paths for in-app notification taps.
 *
 * ## In-app UI contract (every in-app notification)
 * Payload must be renderable without switching on `type`:
 * - `headline` (required) — title
 * - `summary` (required) — body
 * - `preview` (optional) — short snippet (e.g. chat / lesson title)
 * - `route` (required when there is somewhere to go) — tap target
 *
 * Extra fields (`booking_id`, `coach_name`, …) are optional metadata.
 *
 * ## Frontend (bell / NotificationCard)
 * ```js
 * const title = notification.payload.headline;
 * const body = notification.payload.summary;
 * const preview = notification.payload.preview;
 * if (notification.payload?.route) {
 *   navigate(notification.payload.route);
 * }
 * ```
 * No `switch (notification.type)` required for rendering or navigation.
 *
 * ## Backend convention (new in-app notification types)
 * Set `headline`, `summary`, and preferably `route` at creation time.
 * Prefer explicit `route` (e.g. `review_received` → `/reviews/15`).
 * Legacy fallbacks: `new_message` + `conversation_id`, or `booking_id` → `/bookings/:id`.
 *
 * Email-only notifications (password reset, verify email) typically omit UI fields / `route`.
 *
 * Resolution order in `notificationRouteFor`:
 * 1. Explicit `payload.route`
 * 2. `new_message` + `conversation_id` → `/messages/:id`
 * 3. `booking_id` → `/bookings/:id`
 */

/**
 * @param {string} type
 * @param {object} [payload]
 * @returns {string|null}
 */
export function notificationRouteFor(type, payload = {}) {
  if (!payload || typeof payload !== 'object') return null;

  if (payload.route != null && String(payload.route).trim() !== '') {
    return String(payload.route).trim();
  }

  if (type === 'new_message' && payload.conversation_id != null) {
    return `/messages/${payload.conversation_id}`;
  }

  // Booking lifecycle + reminders share a booking detail screen.
  if (payload.booking_id != null) {
    return `/bookings/${payload.booking_id}`;
  }

  return null;
}

/**
 * Return a shallow copy of payload with `route` set when derivable.
 * Never overwrites an explicit `payload.route`.
 */
export function withNotificationRoute(type, payload = {}) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload }
    : {};
  const route = notificationRouteFor(type, base);
  if (route == null) return base;
  return { ...base, route };
}
