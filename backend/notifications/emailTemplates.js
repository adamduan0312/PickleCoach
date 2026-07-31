/**
 * Email subject + HTML body templates for notification delivery (SendGrid).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * MVP reminder email: pre_lesson_24h only (pre_lesson_1h is in-app only).
 * Chat (new_message) is in-app only — no email template.
 */

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

export function getEmailContent(type, payload) {
  const scheduledAt = payload?.scheduled_at ? new Date(payload.scheduled_at).toLocaleString() : 'N/A';

  const templates = {
    pre_lesson_24h: `
      <h2>Lesson Reminder - Tomorrow</h2>
      <p>Your pickleball lesson is scheduled for tomorrow at ${scheduledAt}.</p>
      <p>Coach: ${payload?.coach_name || 'Your coach'}</p>
      <p>Don't forget!</p>
    `,
    booking_confirmed: `
      <h2>Booking Confirmed</h2>
      <p>Your lesson with <strong>${payload?.coach_name || 'your coach'}</strong> is confirmed.</p>
      <p><strong>${payload?.lesson_title || 'Lesson'}</strong> — ${scheduledAt}</p>
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    booking_declined: `
      <h2>Booking Declined</h2>
      <p>${payload?.headline || 'Coach declined your booking.'}</p>
      <p><strong>${payload?.lesson_title || 'your lesson'}</strong> — ${scheduledAt}</p>
      ${payload?.reason_line ? `<p><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.message_to_student ? `<p><strong>Message:</strong><br>${payload.message_to_student}</p>` : ''}
      <p>You can book another available slot in PickleCoach.</p>
    `,
    booking_cancelled: `
      <h2>Booking Cancelled</h2>
      <p>${payload?.headline || `The lesson <strong>${payload?.lesson_title || 'Lesson'}</strong> scheduled for ${scheduledAt} was cancelled.`}</p>
      ${payload?.reason_line ? `<p><strong>${payload.reason_line}</strong></p>` : ''}
      ${payload?.reason_notes ? `<p>${payload.reason_notes}</p>` : ''}
      ${payload?.refund_line ? `<p>${payload.refund_line}</p>` : ''}
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
    `,
    password_reset: `
      <h2>Reset Your Password</h2>
      <p>You requested to reset your password for your PickleCoach account.</p>
      <p>Click the link below to reset your password (expires in ${payload?.expires_in || '1 hour'}):</p>
      <p><a href="${payload?.reset_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.reset_url || ''}</p>
      <p>If you didn't request this, please ignore this email.</p>
      <p><small>This link will expire in ${payload?.expires_in || '1 hour'}.</small></p>
    `,
    email_verification: `
      <h2>Verify Your Email</h2>
      <p>Thanks for creating a PickleCoach account.</p>
      <p>Click the link below to verify your email address (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p><a href="${payload?.verify_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.verify_url || ''}</p>
      <p>If you didn't create this account, you can ignore this email.</p>
    `,
    email_change_confirm: `
      <h2>Confirm Your New Email</h2>
      <p>You requested to change the email address on your PickleCoach account to <strong>${payload?.new_email || ''}</strong>.</p>
      <p>Click the link below to confirm this change (expires in ${payload?.expires_in || '24 hours'}):</p>
      <p><a href="${payload?.confirm_url || '#'}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Confirm Email Change</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p>${payload?.confirm_url || ''}</p>
      <p>If you did not request this change, you can ignore this email.</p>
    `,
    email_changed_notification: `
      <h2>Your Email Address Was Changed</h2>
      <p>The email address on your PickleCoach account was changed from <strong>${payload?.old_email || ''}</strong> to <strong>${payload?.new_email || ''}</strong>.</p>
      <p>If you made this change, no further action is needed.</p>
      <p>If you did <strong>not</strong> make this change, please contact support immediately.</p>
    `,
    booking_request_coach: `
      <h2>You have a new booking request</h2>
      <p><strong>${payload?.student_name || 'A student'}</strong> requested a lesson: <strong>${payload?.lesson_title || 'Lesson'}</strong>.</p>
      <p>Scheduled: ${scheduledAt}</p>
      <p>Booking ID: ${payload?.booking_id ?? ''}</p>
      <p>Please open PickleCoach and accept or decline this request before it expires.</p>
    `,
    stripe_payouts_disabled: `
      <h2>Payouts Paused — Action Needed</h2>
      <p>Stripe has paused payouts for your account (this usually means additional verification is required).</p>
      <p>Your coach profile is <strong>hidden from the marketplace</strong> and you cannot receive new bookings until this is resolved.</p>
      <p>Log in to PickleCoach and reconnect Stripe to complete the required steps — once Stripe re-enables payouts, your profile is relisted automatically.</p>
    `,
    stripe_payouts_enabled: `
      <h2>Payouts Enabled</h2>
      <p>Your Stripe account is ready — you can now receive payouts.</p>
      <p>Your coach profile can appear in the marketplace as soon as your listing checklist (lesson, court, availability) is complete.</p>
    `,
  };

  return templates[type] || `<p>You have a new notification from PickleCoach.</p>`;
}
