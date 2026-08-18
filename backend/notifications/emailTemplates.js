/**
 * Email subject + HTML body templates for notification delivery (SendGrid).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * MVP reminder email: pre_lesson_24h only (pre_lesson_1h is in-app only).
 * Chat (new_message) is in-app only — no email template.
 */

/** Shared primary action link style (inline for email clients). */
export const EMAIL_BUTTON_STYLE =
  'background-color:#0a7;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;';

const SUPPORTED_EMAIL_TYPES = [
  'pre_lesson_24h',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'password_reset',
  'email_verification',
  'email_change_confirm',
  'email_changed_notification',
  'booking_request_coach',
  'stripe_payouts_disabled',
  'stripe_payouts_enabled',
];

export function getEmailSubject(type, _payload) {
  const subjects = {
    pre_lesson_24h: 'Reminder: Your Pickleball Lesson Tomorrow',
    booking_confirmed: 'Booking Confirmed',
    booking_declined: 'Booking Declined',
    booking_cancelled: 'Booking Cancelled',
    password_reset: 'Reset Your PickleCoach Password',
    email_verification: 'Verify Your PickleCoach Email',
    email_change_confirm: 'Confirm Your New PickleCoach Email',
    email_changed_notification: 'Your PickleCoach Email Was Changed',
    booking_request_coach: 'New booking request — PickleCoach',
    stripe_payouts_disabled: 'Action needed: payouts paused on your PickleCoach account',
    stripe_payouts_enabled: 'Payouts enabled on your PickleCoach account',
  };
  return subjects[type] || 'Notification from PickleCoach';
}

/**
 * Table-based HTML shell for consistent PickleCoach email appearance.
 * No external assets — safe for Gmail / Apple Mail.
 * @param {string} innerHtml — template-specific body fragment
 */
export function wrapEmailHtml(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>PickleCoach</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222222;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f4;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border:1px solid #e0e0e0;border-radius:8px;">
<tr>
<td style="padding:24px 28px 12px 28px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;font-size:22px;font-weight:700;letter-spacing:0.02em;color:#0a7;">PickleCoach</p>
</td>
</tr>
<tr>
<td style="padding:0 28px;">
<hr style="border:none;border-top:1px solid #e0e0e0;margin:0;" />
</td>
</tr>
<tr>
<td style="padding:20px 28px 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#222222;">
${innerHtml}
</td>
</tr>
<tr>
<td style="padding:0 28px;">
<hr style="border:none;border-top:1px solid #e0e0e0;margin:0;" />
</td>
</tr>
<tr>
<td style="padding:16px 28px 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#666666;">
You're receiving this because you have a PickleCoach account.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/**
 * Template-specific HTML fragment (no outer shell).
 * @param {string} type
 * @param {object} [payload]
 */
export function getEmailBodyFragment(type, payload = {}) {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';

  const templates = {
    pre_lesson_24h: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Lesson Reminder - Tomorrow</h2>
      <p style="margin:0 0 12px 0;">Your pickleball lesson is scheduled for tomorrow at ${scheduledAt}.</p>
      <p style="margin:0 0 12px 0;">Coach: ${payload?.coach_name || 'Your coach'}</p>
      <p style="margin:0;">Don't forget!</p>
    `,
    booking_confirmed: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Booking Confirmed</h2>
      <p style="margin:0 0 12px 0;">Your lesson with <strong>${payload?.coach_name || 'your coach'}</strong> is confirmed.</p>
      <p style="margin:0 0 12px 0;"><strong>${payload?.lesson_title || 'Lesson'}</strong> — ${scheduledAt}</p>
      <p style="margin:0;">Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    booking_declined: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Booking Declined</h2>
      <p style="margin:0 0 12px 0;">${payload?.headline || 'Coach declined your booking.'}</p>
      <p style="margin:0 0 12px 0;"><strong>${payload?.lesson_title || 'your lesson'}</strong> — ${scheduledAt}</p>
      ${payload?.reason_line ? `<p style="margin:0 0 12px 0;"><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.message_to_student ? `<p style="margin:0 0 12px 0;"><strong>Message:</strong><br>${payload.message_to_student}</p>` : ''}
      <p style="margin:0;">You can book another available slot in PickleCoach.</p>
    `,
    booking_cancelled: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Booking Cancelled</h2>
      <p style="margin:0 0 12px 0;">${payload?.headline || `The lesson <strong>${payload?.lesson_title || 'Lesson'}</strong> scheduled for ${scheduledAt} was cancelled.`}</p>
      ${payload?.reason_line ? `<p style="margin:0 0 12px 0;"><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.reason_notes ? `<p style="margin:0 0 12px 0;">${payload.reason_notes}</p>` : ''}
      ${payload?.refund_line ? `<p style="margin:0 0 12px 0;">${payload.refund_line}</p>` : ''}
      <p style="margin:0;">Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    password_reset: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Reset Your Password</h2>
      <p style="margin:0 0 12px 0;">You requested to reset your password for your PickleCoach account.</p>
      <p style="margin:0 0 12px 0;">Click the link below to reset your password (expires in ${payload?.expires_in || '1 hour'}):</p>
      <p style="margin:0 0 16px 0;"><a href="${payload?.reset_url || '#'}" style="${EMAIL_BUTTON_STYLE}">Reset Password</a></p>
      <p style="margin:0 0 12px 0;">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${payload?.reset_url || ''}</p>
      <p style="margin:0 0 12px 0;">If you didn't request this, please ignore this email.</p>
      <p style="margin:0;font-size:14px;color:#666666;">This link will expire in ${payload?.expires_in || '1 hour'}.</p>
    `,
    email_verification: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Verify Your Email</h2>
      <p style="margin:0 0 12px 0;">Thanks for creating a PickleCoach account.</p>
      <p style="margin:0 0 12px 0;">Click the link below to verify your email address (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p style="margin:0 0 16px 0;"><a href="${payload?.verify_url || '#'}" style="${EMAIL_BUTTON_STYLE}">Verify Email</a></p>
      <p style="margin:0 0 12px 0;">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${payload?.verify_url || ''}</p>
      <p style="margin:0;">If you didn't create this account, you can ignore this email.</p>
    `,
    email_change_confirm: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Confirm Your New Email</h2>
      <p style="margin:0 0 12px 0;">You requested to change the email address on your PickleCoach account to <strong>${payload?.new_email || ''}</strong>.</p>
      <p style="margin:0 0 12px 0;">Click the link below to confirm this change (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p style="margin:0 0 16px 0;"><a href="${payload?.confirm_url || '#'}" style="${EMAIL_BUTTON_STYLE}">Confirm Email Change</a></p>
      <p style="margin:0 0 12px 0;">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${payload?.confirm_url || ''}</p>
      <p style="margin:0;">If you did not request this change, you can ignore this email.</p>
    `,
    email_changed_notification: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Your Email Address Was Changed</h2>
      <p style="margin:0 0 12px 0;">The email address on your PickleCoach account was changed from <strong>${payload?.old_email || ''}</strong> to <strong>${payload?.new_email || ''}</strong>.</p>
      <p style="margin:0 0 12px 0;">If you made this change, no further action is needed.</p>
      <p style="margin:0;">If you did <strong>not</strong> make this change, please contact support immediately.</p>
    `,
    booking_request_coach: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">You have a new booking request</h2>
      <p style="margin:0 0 12px 0;"><strong>${payload?.student_name || 'A student'}</strong> requested a lesson: <strong>${payload?.lesson_title || 'Lesson'}</strong>.</p>
      <p style="margin:0 0 12px 0;">Scheduled: ${scheduledAt}</p>
      <p style="margin:0 0 12px 0;">Booking ID: ${payload?.booking_id ?? ''}</p>
      <p style="margin:0;">Please open PickleCoach and accept or decline this request before it expires.</p>
    `,
    stripe_payouts_disabled: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Payouts Paused — Action Needed</h2>
      <p style="margin:0 0 12px 0;">Stripe has paused payouts for your account (this usually means additional verification is required).</p>
      <p style="margin:0 0 12px 0;">Your coach profile is <strong>hidden from the marketplace</strong> and you cannot receive new bookings until this is resolved.</p>
      <p style="margin:0;">Log in to PickleCoach and reconnect Stripe to complete the required steps — once Stripe re-enables payouts, your profile is relisted automatically.</p>
    `,
    stripe_payouts_enabled: `
      <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;">Payouts Enabled</h2>
      <p style="margin:0 0 12px 0;">Your Stripe account is ready — you can now receive payouts.</p>
      <p style="margin:0;">Your coach profile can appear in the marketplace as soon as your listing checklist (lesson, court, availability) is complete.</p>
    `,
  };

  return templates[type] || `<p style="margin:0;">You have a new notification from PickleCoach.</p>`;
}

export function getEmailContent(type, payload) {
  return wrapEmailHtml(getEmailBodyFragment(type, payload));
}

/** @deprecated internal export for tests — list of types with dedicated body fragments */
export { SUPPORTED_EMAIL_TYPES };
