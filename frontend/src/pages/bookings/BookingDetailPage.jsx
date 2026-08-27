import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { bookingsApi, messagesApi, reviewsApi, adminApi, disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import {
  bookingStatusLabel,
  bookingStatusTone,
  canCoachAccept,
  canCoachComplete,
  canCoachDecline,
  canCoachMarkNoShow,
  canStudentCancel,
  canReportLessonIssue,
  pendingRequestTimeoutCopy,
  coachAcceptanceDeadlineAt,
  paymentStatusLabel,
  paymentAmountCaption,
  cancelMoneyConsequenceCopy,
  cancelledOutcomeCopy,
  bookingOutcomeCopy,
  messagingLockedCopy,
  hasLessonEnded,
  CANCEL_REASONS,
  DECLINE_REASON_CODES,
} from '../../domain/bookingStatus.js';
import { formatInZone, formatDateInZone, formatTimeInZone, formatRemainingUntil, detectLocalTimezone } from '../../utils/datetime.js';
import { courtLabel, formatMoney, teachingLocationLabel } from '../../utils/format.js';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

function formatAcceptanceDeadline(iso, tz) {
  if (!iso) return null;
  return `${formatDateInZone(iso, tz)} · ${formatTimeInZone(iso, tz)}`;
}

function confirmationWhereLabel(court) {
  if (!court) return 'Court TBD';
  const name = court.name || 'Court';
  const area = teachingLocationLabel(court);
  if (area) {
    const city = String(area).split(',')[0].trim();
    return city ? `${city} — ${name}` : `${area} — ${name}`;
  }
  return courtLabel(court);
}

/**
 * Shown once after checkout (?booked=1). Status-aware: requested vs confirmed.
 */
function PostBookingConfirmationCard({ booking, payment, tz, onDismiss }) {
  const isPending = booking.status === 'pending';
  const isConfirmed = booking.status === 'confirmed';
  const deadlineIso = coachAcceptanceDeadlineAt(booking);
  const deadlineLabel = formatAcceptanceDeadline(deadlineIso, tz);
  const whenLabel = `${formatDateInZone(booking.scheduled_at, tz)} · ${formatTimeInZone(booking.scheduled_at, tz)}`;
  const amount = payment?.total_charge_to_student ?? booking.price;
  const title = isConfirmed
    ? 'Booking confirmed'
    : isPending
      ? 'Booking requested'
      : 'Booking submitted';
  const lead = isConfirmed
    ? 'Your lesson is confirmed. You’re all set.'
    : isPending
      ? 'Your payment is authorized. The coach still needs to accept before the lesson is confirmed.'
      : 'Your booking was submitted.';

  return (
    <section className="card booking-confirmation-card" aria-labelledby="booking-confirmation-heading">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 id="booking-confirmation-heading" style={{ margin: 0 }}>{title}</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>{lead}</p>
        </div>
        <StatusBadge status={booking.status} label={bookingStatusLabel(booking.status)} tone={bookingStatusTone(booking.status)} />
      </div>

      <div className="checkout-summary-coach" style={{ marginTop: '1rem' }}>
        <Avatar name={booking.coach?.full_name} src={booking.coach?.avatar_url} size="lg" />
        <div>
          <div className="checkout-summary-coach-name">{booking.coach?.full_name || 'Coach'}</div>
          <div className="small muted">{booking.lesson?.title || 'Lesson'}</div>
        </div>
      </div>

      <dl className="checkout-summary-list" style={{ marginTop: '1rem' }}>
        <div>
          <dt>Lesson</dt>
          <dd>
            {booking.lesson?.title || 'Lesson'}
            {booking.duration_minutes != null ? ` · ${booking.duration_minutes} minutes` : null}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{whenLabel}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{confirmationWhereLabel(booking.courtLocation)}</dd>
        </div>
        <div className="checkout-summary-total">
          <dt>{isConfirmed ? (paymentAmountCaption(payment) || 'Amount') : 'Amount authorized'}</dt>
          <dd>{formatMoney(amount)}</dd>
        </div>
      </dl>

      <div className="checkout-auth-explainer" style={{ marginTop: '1rem' }}>
        <h3 className="checkout-auth-explainer-title">What happens next</h3>
        {isPending ? (
          <ul className="checkout-auth-explainer-list">
            <li>
              {deadlineLabel
                ? `The coach has until ${deadlineLabel} to accept or decline.`
                : 'The coach will accept or decline your request.'}
            </li>
            <li>You’ll get a notification when they respond.</li>
            <li>If they decline or don’t respond in time, your payment authorization is released.</li>
            <li>You can view this booking anytime from My bookings.</li>
          </ul>
        ) : isConfirmed ? (
          <ul className="checkout-auth-explainer-list">
            <li>Show up on time at the teaching location above.</li>
            <li>You can message your coach from this booking.</li>
            <li>After the lesson, you have 24 hours to report a payment or lesson problem.</li>
          </ul>
        ) : (
          <ul className="checkout-auth-explainer-list">
            <li>Open this booking for the latest status and actions.</li>
          </ul>
        )}
      </div>

      <div className="row" style={{ marginTop: '1rem' }}>
        <Link className="btn" to="/bookings">View my bookings</Link>
        {onDismiss ? (
          <button type="button" className="btn ghost" onClick={onDismiss}>Dismiss</button>
        ) : null}
      </div>
    </section>
  );
}

function PendingAcceptanceBanner({ booking, isCoach, isStudent, tz }) {
  if (booking?.status !== 'pending' || (!isCoach && !isStudent)) return null;
  const deadlineIso = coachAcceptanceDeadlineAt(booking);
  const deadlineLabel = formatAcceptanceDeadline(deadlineIso, tz);
  const title = isCoach ? 'Response needed' : 'Waiting for coach';
  const deadlineLine = deadlineLabel
    ? (isCoach
      ? `Please accept or decline this request by ${deadlineLabel}.`
      : `The coach has until ${deadlineLabel} to accept.`)
    : null;

  return (
    <div className="alert warning booking-acceptance-banner" role="status">
      <strong>{title}</strong>
      {deadlineLine ? <div style={{ marginTop: 4 }}>{deadlineLine}</div> : null}
      <div className="small" style={{ marginTop: 6 }}>
        {pendingRequestTimeoutCopy(booking, { audience: isCoach ? 'coach' : 'student' })}
      </div>
      {deadlineLabel ? (
        <div className="small" style={{ marginTop: 8 }}>
          <strong>Acceptance deadline:</strong> {deadlineLabel}
        </div>
      ) : null}
    </div>
  );
}

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function BookingDetailPage({ admin = false }) {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const justBooked = params.get('booked') === '1';
  const [showPostBooking, setShowPostBooking] = useState(justBooked);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data, error: loadError, loading, setData } = useAsync(async () => {
    const res = admin ? await adminApi.booking(id) : await bookingsApi.getById(id);
    return res.data;
  }, [id, admin]);

  const booking = data;
  const tz = user?.timezone || detectLocalTimezone();
  const isCoach = booking && user?.id === booking.coach_id;
  const isStudent = booking && user?.id === booking.primary_student_id;
  const payments = booking?.payments || (booking?.payment ? [booking.payment] : []);
  const payment = payments[0];

  function dismissPostBooking() {
    setShowPostBooking(false);
    const next = new URLSearchParams(params);
    next.delete('booked');
    setParams(next, { replace: true });
  }

  async function run(action, successMsg) {
    setBusy(true);
    setError(null);
    try {
      await action();
      const res = admin ? await adminApi.booking(id) : await bookingsApi.getById(id);
      setData(res.data);
      setMessage(successMsg);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openMessages() {
    setBusy(true);
    setError(null);
    try {
      let conversationId = booking.conversation?.id;
      if (!conversationId) {
        const created = await messagesApi.createConversation(booking.id);
        conversationId = created.data?.id;
      }
      if (conversationId) navigate(`/messages/${conversationId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><LoadingState /></div>;
  if (loadError) return <div className="page"><ErrorState error={loadError} /></div>;
  if (!booking) return <div className="page"><EmptyState title="Booking not found" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{booking.lesson?.title || 'Booking'}</h1>
          <p className="muted">{formatInZone(booking.scheduled_at, tz)} · {booking.duration_minutes} min</p>
        </div>
        <StatusBadge
          status={booking.status}
          label={bookingStatusLabel(booking.status, { audience: isCoach ? 'coach' : isStudent ? 'student' : undefined })}
          tone={bookingStatusTone(booking.status)}
        />
      </div>
      <Alert tone="success">{message}</Alert>
      <Alert tone="error">{error}</Alert>
      {showPostBooking && isStudent ? (
        <div style={{ marginBottom: 16 }}>
          <PostBookingConfirmationCard
            booking={booking}
            payment={payment}
            tz={tz}
            onDismiss={dismissPostBooking}
          />
        </div>
      ) : null}
      {!showPostBooking || !isStudent ? (
        <PendingAcceptanceBanner booking={booking} isCoach={isCoach} isStudent={isStudent} tz={tz} />
      ) : null}
      {booking.status === 'cancelled' && cancelledOutcomeCopy(booking) ? (
        <Alert tone="info">{cancelledOutcomeCopy(booking)}</Alert>
      ) : null}
      {['student_no_show', 'coach_no_show', 'disputed'].includes(booking.status)
        && bookingOutcomeCopy(booking, { audience: isCoach ? 'coach' : isStudent ? 'student' : undefined }) ? (
        <Alert tone={booking.status === 'disputed' ? 'warning' : 'info'}>
          {bookingOutcomeCopy(booking, { audience: isCoach ? 'coach' : isStudent ? 'student' : undefined })}
        </Alert>
      ) : null}
      <FinancialReviewBanner booking={booking} isCoach={isCoach} isStudent={isStudent} tz={tz} />

      <div className="grid-2">
        <div className="card stack">
          <div><strong>Coach:</strong> {booking.coach?.full_name || '—'}</div>
          <div><strong>Student:</strong> {booking.primaryStudent?.full_name || '—'}</div>
          <div><strong>Price:</strong> {formatMoney(booking.price)}</div>
          <div><strong>Location:</strong> {courtLabel(booking.courtLocation)}</div>
          {booking.decline_message_to_student ? (
            <div><strong>Coach message:</strong> {booking.decline_message_to_student}</div>
          ) : null}
          {paymentStatusLabel(payment) ? <div>{paymentStatusLabel(payment)}</div> : null}
          {payment?.total_charge_to_student != null ? (
            <div className="small muted">
              {paymentAmountCaption(payment) || 'Amount'}
              :
              {' '}
              {formatMoney(payment.total_charge_to_student)}
            </div>
          ) : null}
          {isCoach && payment?.coach_payout_expected != null ? (
            <div className="small muted">Expected payout: {formatMoney(payment.coach_payout_expected)}</div>
          ) : null}
          {messagingLockedCopy(booking) ? (
            <div className="small muted">{messagingLockedCopy(booking)}</div>
          ) : null}
        </div>
        <div className="card stack">
          <h2>Actions</h2>
          {!booking.messaging_locked ? (
            <button className="btn secondary" type="button" disabled={busy} onClick={openMessages}>Open conversation</button>
          ) : null}
          {isCoach && canCoachAccept(booking) ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                const ok = window.confirm(
                  'Accept this booking? The student’s card will be charged now. Declining or letting the request expire releases the authorization instead.',
                );
                if (!ok) return;
                run(() => bookingsApi.accept(id), 'Booking accepted. The student’s payment has been captured.');
              }}
            >
              Accept & charge student
            </button>
          ) : null}
          {isCoach && canCoachDecline(booking) ? (
            <DeclineForm busy={busy} onSubmit={(body) => run(() => bookingsApi.decline(id, body), 'Booking declined. Authorization released.')} />
          ) : null}
          {isCoach && ['confirmed', 'awaiting_verification'].includes(booking.status) && !hasLessonEnded(booking) ? (
            <p className="small muted">
              Attendance actions (complete / student no-show) become available after the lesson ends.
            </p>
          ) : null}
          {isCoach && (canCoachComplete(booking) || canCoachMarkNoShow(booking)) ? (
            <p className="small muted">
              Complete and no-show confirm attendance only. They do not release payment. Both sides have 24 hours after the lesson to report a problem.
            </p>
          ) : null}
          {isCoach && canCoachComplete(booking) ? (
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                const ok = window.confirm(
                  'Mark this lesson complete? This confirms attendance only. It does not release payment. Both sides have 24 hours after the lesson to report a problem before payment is normally finalized.',
                );
                if (!ok) return;
                run(() => bookingsApi.complete(id, {}), 'Lesson marked complete. Payment is still held for 24 hours after the lesson ends.');
              }}
            >
              Mark complete (does not release payment)
            </button>
          ) : null}
          {isCoach && canCoachMarkNoShow(booking) ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                const ok = window.confirm(
                  'Record student no-show? There is no student refund. Payout still waits until 24 hours after the lesson ends if no issue is reported. The student’s reliability score is affected; yours is not.',
                );
                if (!ok) return;
                run(() => bookingsApi.studentNoShow(id, {}), 'Recorded student no-show. Payout still waits until 24 hours after the lesson ends if no issue is reported.');
              }}
            >
              Student no-show (no refund)
            </button>
          ) : null}
          {(isStudent || isCoach) && canStudentCancel(booking) ? (
            <CancelForm
              busy={busy}
              consequence={cancelMoneyConsequenceCopy(booking, payment, { audience: isCoach ? 'coach' : 'student' })}
              onSubmit={(body) => run(() => bookingsApi.cancel(id, body), 'Booking cancelled.')}
            />
          ) : null}
          {isStudent && ['completed', 'student_no_show', 'coach_no_show'].includes(booking.status) ? (
            <ReviewForm bookingId={booking.id} busy={busy} onSubmit={(body) => run(() => reviewsApi.create(body), 'Review submitted.')} />
          ) : null}
          {admin ? <AdminBookingActions id={id} busy={busy} run={run} /> : null}
          {(isStudent || isCoach) && canReportLessonIssue(booking) ? (
            <ReportIssueForm
              booking={booking}
              isCoach={isCoach}
              busy={busy}
              onSubmit={(body) => run(() => disputesApi.create(body), 'Issue reported. Payout stays protected while this report is open.')}
            />
          ) : null}
          <p className="small muted">
            There is no reschedule API. To change the time, cancel this booking and book a new slot.
          </p>
        </div>
      </div>
      {Array.isArray(booking.cancellationHistory) && booking.cancellationHistory.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Cancellation history</h2>
          {booking.cancellationHistory.map((row) => (
            <div key={row.id} className="small">
              {row.cancelled_by} · {row.reason} {row.reason_notes ? `— ${row.reason_notes}` : ''}
            </div>
          ))}
        </div>
      ) : null}
      <p className="small" style={{ marginTop: 16 }}>
        <Link to={isCoach ? '/coach/bookings' : '/bookings'}>Back to list</Link>
      </p>
    </div>
  );
}

function FinancialReviewBanner({ booking, isCoach, isStudent, tz }) {
  const now = useNow(15000);
  const review = booking?.financial_review;
  if (!review?.review_until) return null;
  const lessonEnded = review.lesson_ended_at && new Date(review.lesson_ended_at).getTime() <= now;
  if (!lessonEnded && !review.window_open) return null;
  const deadline = formatInZone(review.review_until, tz);
  const remaining = formatRemainingUntil(review.review_until, new Date(now));
  const stillOpen = remaining !== 'ended';
  const payoutPaid = ['processing', 'paid'].includes(String(booking.payout_status || ''));

  if (payoutPaid) {
    return (
      <Alert tone="success">
        <strong>Payment released.</strong> The 24-hour review period ended and the coach's payout was sent. Exceptional corrections after this point require support.
      </Alert>
    );
  }

  if (stillOpen && (review.window_open || lessonEnded)) {
    if (isStudent) {
      return (
        <Alert tone="info">
          <strong>You have 24 hours after the lesson to report a problem before payment is finalized.</strong>
          {' '}Time left: <strong>{remaining}</strong> (until {deadline}).
        </Alert>
      );
    }
    if (isCoach) {
      return (
        <Alert tone="info">
          <strong>Payout is protected for 24 hours after the lesson.</strong> Complete / no-show do not release payment.
          {' '}Time left to report a problem: <strong>{remaining}</strong> (until {deadline}).
        </Alert>
      );
    }
    return (
      <Alert tone="info">
        Review period: <strong>{remaining}</strong> left (until {deadline}). Payment is not released until this ends.
      </Alert>
    );
  }

  if (lessonEnded) {
    return (
      <Alert tone="info">
        <strong>The review period has closed.</strong> This booking is normally financially final.
        {' '}Ended {deadline}. Exceptional corrections may require support.
      </Alert>
    );
  }
  return null;
}

function ReportIssueForm({ booking, isCoach, busy, onSubmit }) {
  const { data: types } = useAsync(async () => asList((await disputesApi.types()).data), []);
  const allowedCodes = isCoach
    ? ['student_no_show_claim', 'misconduct', 'lesson_not_completed', 'other']
    : ['coach_no_show_claim', 'misconduct', 'lesson_not_completed', 'other'];
  const options = (types || []).filter((t) => allowedCodes.includes(t.code));
  const [disputeTypeId, setDisputeTypeId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!disputeTypeId && options[0]) {
      setDisputeTypeId(String(options[0].id));
    }
  }, [types, isCoach, disputeTypeId]);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disputeTypeId) return;
        onSubmit({
          booking_id: Number(booking.id),
          dispute_type_id: Number(disputeTypeId),
          notes: notes || undefined,
        });
      }}
    >
      <h3>Report an issue</h3>
      <p className="small muted">
        You have until {formatInZone(booking.financial_review?.review_until)} ({formatRemainingUntil(booking.financial_review?.review_until)} left) to report a payment or lesson problem before this booking is normally finalized.
      </p>
      <FormField label="Issue type" name="dispute_type_id">
        <select id="dispute_type_id" value={disputeTypeId} onChange={(e) => setDisputeTypeId(e.target.value)} required>
          {options.map((t) => (
            <option key={t.id} value={t.id}>{t.name || t.code}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Notes (optional)" name="dispute_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="btn danger" type="submit" disabled={busy || !disputeTypeId}>Report issue</button>
    </form>
  );
}

function CancelForm({ onSubmit, busy, consequence }) {
  const [reason, setReason] = useState('schedule_conflict');
  const [notes, setNotes] = useState('');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit({ reason, reason_notes: notes || undefined }); }}>
      <h3 style={{ margin: 0, fontSize: '1rem' }}>Cancel booking</h3>
      {consequence ? (
        <div className="alert warning" role="status">
          <strong>If you cancel</strong>
          <div className="small" style={{ marginTop: 4 }}>{consequence}</div>
        </div>
      ) : null}
      <FormField label="Cancel reason" name="reason">
        <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {CANCEL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </FormField>
      <FormField label="Notes (optional)" name="reason_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="btn danger" type="submit" disabled={busy}>Cancel booking</button>
    </form>
  );
}

function DeclineForm({ onSubmit, busy }) {
  const [message_to_student, setMessage] = useState('');
  const [decline_reason_code, setCode] = useState('availability_conflict');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit({ message_to_student, decline_reason_code }); }}>
      <div className="alert info" role="status">
        <strong>Can’t take this lesson?</strong>
        <div className="small" style={{ marginTop: 4 }}>
          Decline so the student can keep looking. Their payment authorization will be released. Declining does not affect your reliability score.
        </div>
      </div>
      <FormField label="Message to student" name="message_to_student">
        <textarea id="message_to_student" value={message_to_student} onChange={(e) => setMessage(e.target.value)} required minLength={10} />
      </FormField>
      <FormField label="Reason" name="decline_reason_code">
        <select id="decline_reason_code" value={decline_reason_code} onChange={(e) => setCode(e.target.value)}>
          {DECLINE_REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </FormField>
      <button className="btn danger" type="submit" disabled={busy}>Decline request</button>
    </form>
  );
}

function ReviewForm({ bookingId, onSubmit, busy }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit({ booking_id: Number(bookingId), rating: Number(rating), comment }); }}>
      <FormField label="Rating" name="rating">
        <select id="rating" value={rating} onChange={(e) => setRating(e.target.value)}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </FormField>
      <FormField label="Comment" name="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="btn secondary" type="submit" disabled={busy}>Submit review</button>
    </form>
  );
}

function AdminBookingActions({ id, busy, run }) {
  return (
    <div className="stack">
      <h3>Admin</h3>
      <button className="btn secondary" type="button" disabled={busy} onClick={() => run(() => adminApi.refundBooking(id, { reason: 'requested_by_customer' }), 'Refund submitted.')}>Refund</button>
      <CancelForm busy={busy} onSubmit={(body) => run(() => adminApi.cancelBooking(id, body), 'Admin cancelled.')} />
    </div>
  );
}
