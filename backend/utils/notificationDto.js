import { withNotificationRoute } from '../notifications/notificationRoutes.js';

/** Keys that must never appear in client-facing notification payloads. */
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'reset_token',
  'verify_token',
  'password_reset_token',
  'email_verification_token',
  'email_change_token',
  'token',
  'reset_url',
  'verify_url',
  'confirm_url',
]);

const NOTIFICATION_FIELD_NAMES = [
  'id',
  'user_id',
  'type',
  'channel',
  'entity_type',
  'entity_id',
  'status',
  'read_at',
  'sent_at',
  'created_at',
];

function toPlain(row) {
  if (!row) return null;
  return row?.toJSON ? row.toJSON() : { ...row };
}

/**
 * Strip tokens and magic-link URLs from notification payloads returned to clients.
 * Email/SMS delivery payloads may contain secrets; in-app API responses must not echo them.
 */
export function redactNotificationPayload(payload) {
  if (payload == null) return payload;
  if (typeof payload !== 'object' || Array.isArray(payload)) return payload;

  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function serializeNotification(notification) {
  if (!notification) return notification;
  const plain = toPlain(notification);
  const dto = {};
  for (const key of NOTIFICATION_FIELD_NAMES) {
    if (plain[key] !== undefined) dto[key] = plain[key];
  }
  if (plain.payload !== undefined) {
    // Enrich missing `route` for older rows so the client can navigate without type switches.
    const withRoute = withNotificationRoute(plain.type, plain.payload);
    dto.payload = redactNotificationPayload(withRoute);
  }
  return dto;
}
