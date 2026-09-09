/**
 * Email subject + HTML body templates for notification delivery (SendGrid).
 * Presentation only — orchestration lives in services/notificationService.js.
 *
 * MVP reminder email: pre_lesson_24h only (pre_lesson_1h is in-app only).
 * Chat (`new_message`) is in-app only — no email template.
 *
 * Booking emails expect timezone-aware fields from the payload builder:
 *   lesson_date, lesson_time, lesson_when, timezone, location_line / court_name / court_address
 * Templates never call toLocaleString() for display.
 */

import { bookingRequestCoachTimeoutCopy } from '../utils/coachAcceptanceTimeout.js';
import { escapeHtml } from '../utils/htmlEscape.js';

/** Shared primary action link style (inline for email clients). */
export const EMAIL_BUTTON_STYLE =
  'background-color:#0a7;color:#ffffff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;';

const DETAIL_CARD_STYLE =
  'margin:0 0 20px 0;width:100%;border:1px solid #e8e8e8;border-radius:8px;background-color:#fafafa;';
const DETAIL_LABEL_STYLE =
  'margin:0 0 2px 0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#666666;';
const DETAIL_VALUE_STYLE = 'margin:0;font-size:16px;font-weight:600;color:#222222;';
const DETAIL_CELL_STYLE = 'padding:14px 16px 0 16px;font-family:Arial,Helvetica,sans-serif;';
const DETAIL_CELL_LAST_STYLE = 'padding:14px 16px 16px 16px;font-family:Arial,Helvetica,sans-serif;';
const HEADING_STYLE = 'margin:0 0 12px 0;font-size:20px;font-weight:700;color:#222222;';
const BODY_P_STYLE = 'margin:0 0 12px 0;';
const MUTED_FOOTER_STYLE = 'margin:24px 0 0 0;font-size:12px;line-height:1.4;color:#999999;';

function frontendBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
  return String(raw).split(',')[0].trim().replace(/\/$/, '') || 'http://localhost:5173';
}

/** Absolute app URL for email CTAs (booking detail, discover, etc.). */
export function emailAppUrl(path = '/') {
  const base = frontendBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

function emailButton(label, href) {
  if (!href) return '';
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<p style="margin:0 0 16px 0;"><a href="${safeHref}" style="${EMAIL_BUTTON_STYLE}">${safeLabel}</a></p>`;
}

function bookingIdFooter(bookingId) {
  if (bookingId == null || String(bookingId).trim() === '') return '';
  return `<p style="${MUTED_FOOTER_STYLE}">Booking #${escapeHtml(bookingId)}</p>`;
}

function emailDetailRow(label, value) {
  if (value == null || String(value).trim() === '') return '';
  return `<p style="margin:0 0 8px 0;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

/**
 * Resolve display when from structured fields (preferred) or never raw toLocaleString.
 * @returns {{ date: string|null, time: string|null, when: string|null }}
 */
function resolveLessonWhen(payload = {}) {
  const date = payload.lesson_date && String(payload.lesson_date).trim()
    ? String(payload.lesson_date).trim()
    : null;
  const time = payload.lesson_time && String(payload.lesson_time).trim()
    ? String(payload.lesson_time).trim()
    : null;
  if (payload.lesson_when && String(payload.lesson_when).trim()) {
    return { date, time, when: String(payload.lesson_when).trim() };
  }
  if (date && time) return { date, time, when: `${date} · ${time}` };
  if (date) return { date, time, when: date };
  if (time) return { date, time, when: time };
  return { date: null, time: null, when: null };
}

function resolveLocationLine(payload = {}) {
  if (payload.location_line && String(payload.location_line).trim()) {
    return String(payload.location_line).trim();
  }
  const parts = [payload.court_name, payload.court_address]
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => String(p).trim());
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

function detailBlock(label, value, { last = false } = {}) {
  if (value == null || String(value).trim() === '') return '';
  const cell = last ? DETAIL_CELL_LAST_STYLE : DETAIL_CELL_STYLE;
  return `<tr><td style="${cell}">
<p style="${DETAIL_LABEL_STYLE}">${escapeHtml(label)}</p>
<p style="${DETAIL_VALUE_STYLE}">${escapeHtml(value)}</p>
</td></tr>`;
}

/**
 * Structured booking summary card: Lesson / Person / When / Location.
 * When is a single combined line including timezone abbr when provided by the payload.
 */
function bookingDetailCard(payload = {}, { personLabel = 'With', personName = null } = {}) {
  const lessonTitle = payload.lesson_title || 'Lesson';
  const { when } = resolveLessonWhen(payload);
  const location = resolveLocationLine(payload);
  const address = payload.court_address && String(payload.court_address).trim()
    && String(payload.court_address).trim() !== location
    ? String(payload.court_address).trim()
    : null;

  const rows = [
    detailBlock('Lesson', lessonTitle),
    personName ? detailBlock(personLabel, personName) : '',
    when ? detailBlock('When', when) : '',
    location ? detailBlock('Location', location, { last: !address }) : '',
    address ? detailBlock('Address', address, { last: true }) : '',
  ].filter(Boolean).join('');

  if (!rows) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${DETAIL_CARD_STYLE}">${rows}</table>`;
}

/**
 * Rich pre-lesson reminder body: other party + lesson + when + booking court.
 */
function preLesson24hBody(payload = {}) {
  const isCoach = payload.audience === 'coach';
  const personLabel = isCoach ? 'Student' : 'Coach';
  const personName = isCoach
    ? (payload.student_name || 'Your student')
    : (payload.coach_name || 'Your coach');
  const card = bookingDetailCard(payload, { personLabel, personName });
  const { when } = resolveLessonWhen(payload);
  const whenFallback = !card && when
    ? `<p style="${BODY_P_STYLE}">Scheduled: ${escapeHtml(when)}</p>`
    : !card
      ? `<p style="${BODY_P_STYLE}">Scheduled: see your booking in PickleCoach.</p>`
      : '';

  return `
      <h2 style="${HEADING_STYLE}">Tomorrow's lesson</h2>
      <p style="${BODY_P_STYLE}">Your pickleball lesson is scheduled for tomorrow.</p>
      ${card}
      ${whenFallback}
      ${payload.booking_id != null ? emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`)) : ''}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

const SUPPORTED_EMAIL_TYPES = [
  'pre_lesson_24h',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'password_reset',
  'password_changed',
  'email_verification',
  'email_change_confirm',
  'email_changed_notification',
  'booking_request_coach',
  'stripe_payouts_disabled',
  'stripe_payouts_enabled',
  'student_no_show',
  'coach_no_show',
  'dispute_opened',
  'dispute_resolved',
  'booking_request_expired',
  'refund_succeeded',
  'review_received',
];

export function getEmailSubject(type, payload) {
  const bookingRequestSubject = payload?.coach_acceptance_deadline_label
    ? `Booking request — respond by ${payload.coach_acceptance_deadline_label}`
    : 'New booking request — PickleCoach';
  const subjects = {
    pre_lesson_24h: 'Reminder: Your Pickleball Lesson Tomorrow',
    booking_confirmed: 'Booking Confirmed',
    booking_declined: 'Booking Declined',
    booking_cancelled: 'Booking Cancelled',
    password_reset: 'Reset Your PickleCoach Password',
    password_changed: 'Your PickleCoach password was changed',
    email_verification: 'Verify Your PickleCoach Email',
    email_change_confirm: 'Confirm Your New PickleCoach Email',
    email_changed_notification: 'Your PickleCoach Email Was Changed',
    booking_request_coach: bookingRequestSubject,
    stripe_payouts_disabled: 'Action needed: payouts paused on your PickleCoach account',
    stripe_payouts_enabled: 'Payouts enabled on your PickleCoach account',
    student_no_show: 'You were marked as a no-show',
    coach_no_show: payload?.headline || 'Coach no-show recorded',
    dispute_opened: payload?.headline || 'An issue was reported',
    dispute_resolved: 'Dispute resolved',
    booking_request_expired: 'Booking request expired',
    refund_succeeded: 'Refund completed',
    review_received: 'You received a new review',
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

function bookingRequestCoachBody(payload = {}) {
  const studentName = payload.student_name || 'A student';
  const card = bookingDetailCard(payload, {
    personLabel: 'Student',
    personName: studentName,
  });
  const deadline = payload.coach_acceptance_deadline_label
    ? String(payload.coach_acceptance_deadline_label).trim()
    : '';
  const deadlineBlock = deadline
    ? `<p style="${BODY_P_STYLE}"><strong>Please accept or decline by ${escapeHtml(deadline)}.</strong></p>
      <p style="${BODY_P_STYLE}">If you don't respond by then, the request will expire automatically and the student's payment authorization will be released.</p>`
    : `<p style="${BODY_P_STYLE}">${escapeHtml(
      bookingRequestCoachTimeoutCopy(
        payload.coach_acceptance_timeout_hours,
        payload.min_booking_lead_hours,
      ),
    )}</p>`;

  return `
      <h2 style="${HEADING_STYLE}">You have a new booking request</h2>
      <p style="${BODY_P_STYLE}"><strong>${escapeHtml(studentName)}</strong> requested:</p>
      ${card}
      ${deadlineBlock}
      ${emailButton('View booking request', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function bookingConfirmedBody(payload = {}) {
  const coachName = payload.coach_name || 'your coach';
  const card = bookingDetailCard(payload, {
    personLabel: 'With',
    personName: coachName,
  });
  return `
      <h2 style="${HEADING_STYLE}">Booking confirmed</h2>
      <p style="${BODY_P_STYLE}">Your lesson with <strong>${escapeHtml(coachName)}</strong> is confirmed.</p>
      ${card}
      <p style="${BODY_P_STYLE}"><strong>What happens next</strong></p>
      <p style="${BODY_P_STYLE}">Your card was authorized when you requested the lesson. Payment is normally finalized after the 24-hour post-lesson review window.</p>
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function bookingDeclinedBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: 'Coach',
    personName: payload.coach_name || null,
  });
  const message = payload.message_to_student
    ? `<p style="${BODY_P_STYLE}"><strong>Message from your coach</strong><br>${escapeHtml(payload.message_to_student)}</p>`
    : '';
  const reason = payload.reason_line
    ? `<p style="${BODY_P_STYLE}">${escapeHtml(payload.reason_line)}</p>`
    : '';
  return `
      <h2 style="${HEADING_STYLE}">Booking declined</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.headline || 'Coach declined your booking.')}</p>
      ${card}
      ${reason}
      ${message}
      <p style="${BODY_P_STYLE}">Your payment authorization was released. You were not charged. You can book another available slot.</p>
      ${emailButton('Find another lesson', emailAppUrl('/discover'))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function bookingCancelledBody(payload = {}) {
  const by = payload.cancelled_by;
  const personLabel = by === 'student' ? 'Student' : 'Coach';
  const personName = by === 'student'
    ? (payload.student_name || null)
    : (payload.coach_name || null);
  const card = bookingDetailCard(payload, { personLabel, personName });
  const reason = payload.reason_line
    ? `<p style="${BODY_P_STYLE}">${escapeHtml(payload.reason_line)}</p>`
    : '';
  const notes = payload.reason_notes
    ? `<p style="${BODY_P_STYLE}">${escapeHtml(payload.reason_notes)}</p>`
    : '';
  const refund = payload.refund_line
    ? `<p style="${BODY_P_STYLE}">${escapeHtml(payload.refund_line)}</p>`
    : '';
  return `
      <h2 style="${HEADING_STYLE}">Booking cancelled</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.headline || 'This lesson was cancelled.')}</p>
      ${card}
      ${reason}
      ${notes}
      ${refund}
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function bookingRequestExpiredBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: 'Coach',
    personName: payload.coach_name || null,
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'Booking request expired')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(
    payload.summary
      || 'Your coach did not respond in time, so this booking request expired. Your payment authorization was released — you were not charged.',
  )}</p>
      ${card}
      <p style="${BODY_P_STYLE}">You can request another available slot whenever you're ready.</p>
      ${emailButton('Find another lesson', emailAppUrl('/discover'))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function studentNoShowBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: 'Coach',
    personName: payload.coach_name || null,
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'You were marked as a no-show')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'You were marked as not attending this lesson.')}</p>
      ${card}
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function coachNoShowBody(payload = {}) {
  const isStudent = payload.audience !== 'coach';
  const card = bookingDetailCard(payload, {
    personLabel: isStudent ? 'Coach' : 'Student',
    personName: isStudent
      ? (payload.coach_name || null)
      : (payload.student_name || null),
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'Coach no-show recorded')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'This lesson was recorded as a coach no-show.')}</p>
      ${card}
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function disputeResolvedBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: payload.audience === 'coach' ? 'Student' : 'Coach',
    personName: payload.audience === 'coach'
      ? (payload.student_name || null)
      : (payload.coach_name || null),
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'Dispute resolved')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'This dispute was reviewed.')}</p>
      ${card}
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function refundSucceededBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: 'Coach',
    personName: payload.coach_name || null,
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'Refund completed')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'Your refund has been completed.')}</p>
      ${card}
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function disputeOpenedBody(payload = {}) {
  const card = bookingDetailCard(payload, {
    personLabel: payload.audience === 'coach' ? 'Student' : 'Coach',
    personName: payload.audience === 'coach'
      ? (payload.student_name || null)
      : (payload.coach_name || null),
  });
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'An issue was reported')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'An issue was reported on this booking. Payment is on hold until it is reviewed.')}</p>
      ${card}
      <p style="${BODY_P_STYLE}">Payout is blocked while this issue is under review. After the lesson, the review window remains open so either side can respond before payment is normally finalized.</p>
      ${emailButton('View booking', emailAppUrl(`/bookings/${payload.booking_id}`))}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function reviewReceivedBody(payload = {}) {
  const stars = payload.rating != null && Number.isFinite(Number(payload.rating))
    ? `${Number(payload.rating)}★`
    : null;
  const card = bookingDetailCard(payload, {
    personLabel: 'Student',
    personName: payload.student_name || null,
  });
  const comment = payload.comment && String(payload.comment).trim()
    ? `<p style="${BODY_P_STYLE}"><strong>Review</strong><br>${escapeHtml(String(payload.comment).trim())}</p>`
    : '';
  const ratingLine = stars
    ? `<p style="${BODY_P_STYLE}"><strong>Rating:</strong> ${escapeHtml(stars)}</p>`
    : '';
  const ctaHref = payload.booking_id != null
    ? emailAppUrl(`/bookings/${payload.booking_id}`)
    : (payload.route ? emailAppUrl(payload.route) : null);
  return `
      <h2 style="${HEADING_STYLE}">${escapeHtml(payload.headline || 'You received a new review')}</h2>
      <p style="${BODY_P_STYLE}">${escapeHtml(payload.summary || 'A student left a review on your lesson.')}</p>
      ${card}
      ${ratingLine}
      ${comment}
      ${ctaHref ? emailButton('View booking', ctaHref) : ''}
      ${bookingIdFooter(payload.booking_id)}
    `;
}

function passwordChangedBody(payload = {}) {
  return `
      <h2 style="${HEADING_STYLE}">Your password was changed</h2>
      <p style="${BODY_P_STYLE}">The password on your PickleCoach account was changed.</p>
      <p style="${BODY_P_STYLE}">If you made this change, no further action is needed.</p>
      <p style="${BODY_P_STYLE}">If you did <strong>not</strong> make this change, reset your password immediately and contact support.</p>
      ${emailButton('Open account settings', emailAppUrl('/settings'))}
    `;
}

/**
 * Template-specific HTML fragment (no outer shell).
 * @param {string} type
 * @param {object} [payload]
 */
export function getEmailBodyFragment(type, payload = {}) {
  const templates = {
    pre_lesson_24h: preLesson24hBody(payload),
    booking_confirmed: bookingConfirmedBody(payload),
    booking_declined: bookingDeclinedBody(payload),
    booking_cancelled: bookingCancelledBody(payload),
    password_reset: `
      <h2 style="${HEADING_STYLE}">Reset Your Password</h2>
      <p style="${BODY_P_STYLE}">You requested to reset your password for your PickleCoach account.</p>
      <p style="${BODY_P_STYLE}">Click the link below to reset your password (expires in ${escapeHtml(payload?.expires_in || '1 hour')}):</p>
      ${emailButton('Reset Password', payload?.reset_url || '#')}
      <p style="${BODY_P_STYLE}">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${escapeHtml(payload?.reset_url || '')}</p>
      <p style="${BODY_P_STYLE}">If you didn't request this, please ignore this email.</p>
      <p style="margin:0;font-size:14px;color:#666666;">This link will expire in ${escapeHtml(payload?.expires_in || '1 hour')}.</p>
    `,
    password_changed: passwordChangedBody(payload),
    email_verification: `
      <h2 style="${HEADING_STYLE}">Verify Your Email</h2>
      <p style="${BODY_P_STYLE}">Thanks for creating a PickleCoach account.</p>
      <p style="${BODY_P_STYLE}">Click the link below to verify your email address (expires in ${escapeHtml(payload?.expires_in || '24 hours')}):</p>
      ${emailButton('Verify Email', payload?.verify_url || '#')}
      <p style="${BODY_P_STYLE}">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${escapeHtml(payload?.verify_url || '')}</p>
      <p style="margin:0;">If you didn't create this account, you can ignore this email.</p>
    `,
    email_change_confirm: `
      <h2 style="${HEADING_STYLE}">Confirm Your New Email</h2>
      <p style="${BODY_P_STYLE}">You requested to change the email address on your PickleCoach account to <strong>${escapeHtml(payload?.new_email || '')}</strong>.</p>
      <p style="${BODY_P_STYLE}">Click the link below to confirm this change (expires in ${escapeHtml(payload?.expires_in || '24 hours')}):</p>
      ${emailButton('Confirm Email Change', payload?.confirm_url || '#')}
      <p style="${BODY_P_STYLE}">Or copy and paste this URL into your browser:</p>
      <p style="margin:0 0 12px 0;word-break:break-all;">${escapeHtml(payload?.confirm_url || '')}</p>
      <p style="margin:0;">If you did not request this change, you can ignore this email.</p>
    `,
    email_changed_notification: `
      <h2 style="${HEADING_STYLE}">Your Email Address Was Changed</h2>
      <p style="${BODY_P_STYLE}">The email address on your PickleCoach account was changed from <strong>${escapeHtml(payload?.old_email || '')}</strong> to <strong>${escapeHtml(payload?.new_email || '')}</strong>.</p>
      <p style="${BODY_P_STYLE}">If you made this change, no further action is needed.</p>
      <p style="margin:0;">If you did <strong>not</strong> make this change, please contact support immediately.</p>
    `,
    booking_request_coach: bookingRequestCoachBody(payload),
    stripe_payouts_disabled: `
      <h2 style="${HEADING_STYLE}">Payouts Paused — Action Needed</h2>
      <p style="${BODY_P_STYLE}">Stripe has paused payouts for your account (this usually means additional verification is required).</p>
      <p style="${BODY_P_STYLE}">Your coach profile is <strong>hidden from the marketplace</strong> and you cannot receive new bookings until this is resolved.</p>
      <p style="${BODY_P_STYLE}">Log in to PickleCoach and reconnect Stripe to complete the required steps — once Stripe re-enables payouts, your profile is relisted automatically.</p>
      ${emailButton('Open coach onboarding', emailAppUrl('/coach/onboarding'))}
    `,
    stripe_payouts_enabled: `
      <h2 style="${HEADING_STYLE}">Payouts Enabled</h2>
      <p style="${BODY_P_STYLE}">Your Stripe account is ready — you can now receive payouts.</p>
      <p style="${BODY_P_STYLE}">Your coach profile can appear in the marketplace as soon as your listing checklist (lesson, court, availability) is complete.</p>
      ${emailButton('Open coach onboarding', emailAppUrl('/coach/onboarding'))}
    `,
    student_no_show: studentNoShowBody(payload),
    coach_no_show: coachNoShowBody(payload),
    dispute_opened: disputeOpenedBody(payload),
    dispute_resolved: disputeResolvedBody(payload),
    booking_request_expired: bookingRequestExpiredBody(payload),
    refund_succeeded: refundSucceededBody(payload),
    review_received: reviewReceivedBody(payload),
  };

  return templates[type] || `<p style="margin:0;">You have a new notification from PickleCoach.</p>`;
}

export function getEmailContent(type, payload) {
  return wrapEmailHtml(getEmailBodyFragment(type, payload));
}

/** @deprecated internal export for tests — list of types with dedicated body fragments */
export { SUPPORTED_EMAIL_TYPES };
