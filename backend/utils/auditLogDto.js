/**
 * Audit log response DTO — redacts secrets from before_state / after_state JSON.
 */

const SENSITIVE_STATE_KEYS = new Set([
  'password_hash',
  'password',
  'password_reset_token',
  'password_reset_expires',
  'email_verification_token',
  'email_verification_expires',
  'email_change_token',
  'email_change_expires',
  'token',
  'refresh_token',
  'access_token',
  'client_secret',
  'stripe_secret',
]);

function redactValue(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_STATE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function toPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return { ...row };
}

/**
 * Admin audit log list item — keeps operational fields; redacts secrets in state blobs.
 */
export function serializeAuditLog(log) {
  if (!log) return null;
  const plain = toPlain(log);
  return {
    id: plain.id,
    user_id: plain.user_id,
    action: plain.action,
    table_name: plain.table_name,
    record_id: plain.record_id,
    before_state: redactValue(plain.before_state),
    after_state: redactValue(plain.after_state),
    ip_address: plain.ip_address ?? null,
    user_agent: plain.user_agent ?? null,
    created_at: plain.created_at,
  };
}
