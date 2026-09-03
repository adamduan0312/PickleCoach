import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { bookingsApi, messagesApi, reviewsApi, adminApi, disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { CharacterCounter, CharacterMaxHint } from '../../components/ui/CharacterLimit.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import {
  bookingStatusLabel,
  bookingDisplayLabel,
  bookingDisplayTone,
  hasOpenIssueReport,
  canCoachAccept,
  canCoachComplete,
  canCoachDecline,
  canCoachCancel,
  canCoachMarkNoShow,
  canStudentCancel,
  canReportLessonIssue,
  coachAttendanceBlockedByIssue,
  coachAcceptanceDeadlineAt,
  paymentStatusLabel,
  paymentAmountCaption,
  cancelMoneyConsequenceCopy,
  cancelledOutcomeCopy,
  bookingOutcomeCopy,
  messagingLockedCopy,
  hasLessonEnded,
  isPostLessonReviewEligible,
  studentReviewWindowBannerCopy,
  confirmedStudentNoShowReminder,
  studentNoShowConfirmTitle,
  studentNoShowConfirmBody,
  CANCEL_REASONS,
  DECLINE_REASON_CODES,
} from '../../domain/bookingStatus.js';
import {
  adminBookingMoneyStatusItems,
  adminRefundStatusView,
} from '../../domain/adminStatus.js';
import { formatInZone, formatDateInZone, formatTimeInZone, formatRemainingUntil, detectLocalTimezone } from '../../utils/datetime.js';
import { courtLabel, formatMoney } from '../../utils/format.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function formatAcceptanceDeadline(iso, tz) {
  if (!iso) return null;
  return `${formatDateInZone(iso, tz)} · ${formatTimeInZone(iso, tz)}`;
}

function lessonAmountLabel(payment, booking) {
  const caption = payment ? paymentAmountCaption(payment) : null;
  if (caption === 'Authorized') return 'Amount authorized';
  if (caption === 'Charged') return 'Amount charged';
  if (caption === 'Refunded') return 'Amount refunded';
  if (caption === 'Partially refunded') return 'Amount partially refunded';
  if (booking?.status === 'pending') return 'Amount authorized';
  return caption ? `Amount (${caption.toLowerCase()})` : 'Amount';
}

function bookingDetailHeadline(booking, { audience }) {
  if (hasOpenIssueReport(booking) && booking.status !== 'disputed') {
    return 'Issue reported';
  }
  if (booking.status === 'pending') {
    return audience === 'coach' ? 'Response needed' : 'Booking requested';
  }
  if (booking.status === 'confirmed') return 'Booking confirmed';
  if (booking.status === 'completed') return 'Lesson completed';
  return bookingStatusLabel(booking.status, { audience });
}

function bookingDetailLead(booking, { audience, tz }) {
  const coachName = booking.coach?.full_name || 'the coach';
  const studentName = booking.primaryStudent?.full_name || 'the student';
  const deadlineLabel = formatAcceptanceDeadline(coachAcceptanceDeadlineAt(booking), tz);

  // Coach: issue messaging lives in IssueReportedPanel (avoids triple repeat).
  if (audience === 'coach' && (hasOpenIssueReport(booking) || booking.status === 'disputed')) {
    return null;
  }
  if (hasOpenIssueReport(booking) && booking.status !== 'disputed') {
    return 'Your report is under review. Payout is protected while this issue is being reviewed.';
  }

  switch (booking.status) {
    case 'pending':
      if (audience === 'coach') {
        return deadlineLabel
          ? `${studentName} requested a lesson. Please accept or decline by ${deadlineLabel}.`
          : `${studentName} requested a lesson. Please accept or decline.`;
      }
      return `Your request was sent to ${coachName}. Your payment has been authorized but hasn't been charged.`;
    case 'confirmed':
      return audience === 'coach'
        ? 'The lesson is confirmed and the student\'s payment has been captured.'
        : 'Your lesson is confirmed and your payment has been captured.';
    case 'awaiting_verification':
      return audience === 'coach'
        ? 'The lesson time has passed. Confirm attendance below.'
        : 'The lesson time has passed. Waiting for your coach to confirm attendance.';
    case 'completed':
      return audience === 'coach'
        ? 'This lesson is complete.'
        : 'This lesson is complete.';
    case 'cancelled':
      return 'This booking was cancelled.';
    case 'disputed':
      return 'Your report is under review. Payout is protected while this issue is being reviewed.';
    case 'student_no_show':
    case 'coach_no_show':
      return null;
    default:
      return null;
  }
}

function bookingDetailNextSteps(booking, { audience, tz }) {
  const deadlineLabel = formatAcceptanceDeadline(coachAcceptanceDeadlineAt(booking), tz);
  const whenLabel = `${formatDateInZone(booking.scheduled_at, tz)} · ${formatTimeInZone(booking.scheduled_at, tz)}`;

  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    // Coach banner already explains the state; student lead covers theirs.
    return [];
  }

  switch (booking.status) {
    case 'pending':
      if (audience === 'coach') {
        return [
          {
            title: deadlineLabel ? `Respond by ${deadlineLabel}` : 'Accept or decline',
            body: 'Accepting captures the student\'s payment. Declining or missing the deadline releases the authorization.',
          },
          {
            title: 'The student is waiting',
            body: 'They\'ll be notified when you respond.',
          },
        ];
      }
      return [
        {
          title: deadlineLabel ? `Coach responds by ${deadlineLabel}` : 'Coach accepts or declines',
          body: deadlineLabel
            ? `The coach has until ${deadlineLabel} to respond.`
            : 'The coach will accept or decline your request.',
        },
        {
          title: 'You\'ll be notified',
          body: 'We\'ll let you know when the coach responds.',
        },
        {
          title: 'If accepted',
          body: 'The payment is captured according to the booking process.',
        },
      ];
    case 'confirmed':
      if (audience === 'coach') {
        return [
          {
            title: 'Teach the lesson',
            body: `Show up at the scheduled time (${whenLabel}).`,
          },
          {
            title: 'After the lesson ends',
            body: 'Mark the lesson complete or record a student no-show. These confirm attendance only — they do not release payment.',
          },
          {
            title: 'Payout timing',
            body: 'Payment is held for 24 hours after the lesson so either side can report a problem.',
          },
        ];
      }
      return [
        {
          title: 'Attend your lesson',
          body: `Show up on time (${whenLabel}) at the court listed below. ${confirmedStudentNoShowReminder}`,
        },
        {
          title: 'After the lesson',
          body: 'The review and dispute window opens for 24 hours. Payment is not finalized until it closes.',
        },
      ];
    case 'awaiting_verification':
      if (audience === 'coach') {
        return [
          {
            title: 'Confirm attendance',
            body: 'Mark the lesson complete or record a student no-show.',
          },
          {
            title: 'Payment is still protected',
            body: 'Complete and no-show do not release payment. Either side can report a problem for 24 hours after the lesson.',
          },
        ];
      }
      return [
        {
          title: 'Waiting for coach confirmation',
          body: 'Your coach will confirm whether the lesson took place.',
        },
        {
          title: 'Report a problem if needed',
          body: 'If something went wrong, you can report an issue during the review window.',
        },
      ];
    case 'completed':
    case 'student_no_show':
    case 'coach_no_show':
      if (audience === 'student') {
        return [
          {
            title: 'Leave a review',
            body: 'Share feedback about your coach if you haven\'t already.',
          },
          {
            title: 'Review or dispute window',
            body: 'If something went wrong, report an issue before the review period closes.',
          },
        ];
      }
      return [
        {
          title: 'Payout timing',
          body: 'Payment is held for 24 hours after the lesson so either side can report a problem.',
        },
      ];
    case 'disputed':
      return [
        {
          title: 'Issue under review',
          body: 'Payout stays protected while the report is open.',
        },
      ];
    default:
      return [];
  }
}

function BookingDetailLessonSection({ booking, payment, tz, isCoach, admin }) {
  const lessonWhenLabel = `${formatDateInZone(booking.scheduled_at, tz)} · ${formatTimeInZone(booking.scheduled_at, tz)}`;
  const requestedLabel = booking.created_at
    ? `${formatDateInZone(booking.created_at, tz)} · ${formatTimeInZone(booking.created_at, tz)}`
    : null;
  const lessonTitle = booking.lesson?.title || 'Lesson';
  const duration = booking.duration_minutes != null ? ` · ${booking.duration_minutes} min` : '';
  const amount = payment?.total_charge_to_student ?? booking.price;
  const amountLabel = lessonAmountLabel(payment, booking);
  const paymentStatus = paymentStatusLabel(payment);
  const whereLabel = courtLabel(booking.courtLocation);

  return (
    <section className="card stack booking-detail-section booking-detail-lesson">
      <h2 className="booking-detail-section-title">Your lesson</h2>
      <dl className="booking-detail-facts">
        {(!isCoach || admin) ? (
          <div>
            <dt>Coach</dt>
            <dd>{booking.coach?.full_name || '—'}</dd>
          </div>
        ) : null}
        {isCoach && !admin ? (
          <div>
            <dt>Student</dt>
            <dd>{booking.primaryStudent?.full_name || '—'}</dd>
          </div>
        ) : null}
        <div>
          <dt>Lesson</dt>
          <dd>{lessonTitle}{duration}</dd>
        </div>
        {admin ? (
          <div className="booking-detail-facts-full">
            <dt>Student</dt>
            <dd>{booking.primaryStudent?.full_name || '—'}</dd>
          </div>
        ) : null}
        {requestedLabel ? (
          <div>
            <dt>Requested</dt>
            <dd>{requestedLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>When</dt>
          <dd>{lessonWhenLabel}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{whereLabel}</dd>
        </div>
        {amount != null ? (
          <div className="booking-detail-facts-payment">
            <dt>{amountLabel}</dt>
            <dd>
              {formatMoney(amount)}
              {paymentStatus ? <span className="small muted booking-detail-payment-status">{paymentStatus}</span> : null}
            </dd>
          </div>
        ) : null}
        {isCoach && payment?.coach_payout_expected != null ? (
          <div className="booking-detail-facts-full">
            <dt>Expected payout</dt>
            <dd>{formatMoney(payment.coach_payout_expected)}</dd>
          </div>
        ) : null}
        {booking.decline_message_to_student ? (
          <div className="booking-detail-facts-full">
            <dt>Coach message</dt>
            <dd>{booking.decline_message_to_student}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function BookingDetailNextStepsSection({ steps }) {
  if (!steps.length) return null;
  return (
    <section className="card stack booking-detail-section booking-detail-next-steps">
      <h2 className="booking-detail-section-title">What happens next</h2>
      <ol className="booking-detail-steps">
        {steps.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>
    </section>
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
  const audience = isCoach ? 'coach' : isStudent ? 'student' : undefined;

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

  const bookingActions = (
    <>
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
      {isCoach && ['confirmed', 'awaiting_verification'].includes(booking.status) && !hasLessonEnded(booking) && !coachAttendanceBlockedByIssue(booking) ? (
        <p className="small muted">
          Attendance actions (complete / student no-show) become available after the lesson ends.
        </p>
      ) : null}
      {isCoach && coachAttendanceBlockedByIssue(booking) ? (
        <p className="small muted" style={{ margin: 0 }}>
          Attendance actions unavailable while this issue is under review.
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
            const ok = window.confirm(`${studentNoShowConfirmTitle()}\n\n${studentNoShowConfirmBody()}`);
            if (!ok) return;
            run(() => bookingsApi.studentNoShow(id, {}), 'Recorded student no-show. Payout still waits until 24 hours after the lesson ends if no issue is reported.');
          }}
        >
          Student no-show (no refund)
        </button>
      ) : null}
      {(isStudent && canStudentCancel(booking)) || (isCoach && canCoachCancel(booking)) ? (
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
          onSubmit={(body) => run(() => disputesApi.create(body), 'Issue reported. Your report is under review. Payout is protected while this issue is being reviewed.')}
        />
      ) : null}
      {booking.status !== 'pending' ? (
        <p className="small muted">
          There is no reschedule option yet. To change the time, cancel this booking and book a new slot.
        </p>
      ) : null}
    </>
  );

  const headline = admin
    ? `Booking #${booking.id}`
    : bookingDetailHeadline(booking, { audience: audience || 'student' });
  const lead = admin
    ? `${booking.primaryStudent?.full_name || 'Student'} → ${booking.coach?.full_name || 'Coach'}`
    : bookingDetailLead(booking, { audience: audience || 'student', tz });
  const nextSteps = admin ? [] : bookingDetailNextSteps(booking, { audience: audience || 'student', tz });
  const adminStatusItems = admin
    ? [...adminBookingMoneyStatusItems({ booking, payment }), adminRefundStatusView(payment)]
    : null;

  return (
    <div className="page booking-detail-page">
      <Alert tone="success">{message}</Alert>
      <Alert tone="error">{error}</Alert>

      <div className="page-header">
        <div>
          <h1>{headline}</h1>
          {lead ? <p className="muted">{lead}</p> : null}
        </div>
        {admin ? (
          <AdminStatusStack items={adminStatusItems} />
        ) : (
          <StatusBadge
            status={hasOpenIssueReport(booking) && booking.status !== 'disputed' ? 'issue' : booking.status}
            label={bookingDisplayLabel(booking, { audience })}
            tone={bookingDisplayTone(booking)}
          />
        )}
      </div>

      {booking.status === 'cancelled' && cancelledOutcomeCopy(booking) ? (
        <Alert tone="info">{cancelledOutcomeCopy(booking)}</Alert>
      ) : null}
      {/* Open issue: student lead covers messaging; coach uses IssueReportedPanel below. */}
      {!admin && !hasOpenIssueReport(booking)
        && ['student_no_show', 'coach_no_show', 'disputed'].includes(booking.status)
        && bookingOutcomeCopy(booking, { audience }) ? (
        <Alert tone={booking.status === 'disputed' ? 'warning' : 'info'}>
          {bookingOutcomeCopy(booking, { audience })}
        </Alert>
      ) : null}
      {!admin && isCoach && (hasOpenIssueReport(booking) || booking.status === 'disputed') ? (
        <CoachIssueReportedPanel booking={booking} tz={tz} />
      ) : null}
      {!admin ? (
        <FinancialReviewBanner booking={booking} isCoach={isCoach} isStudent={isStudent} tz={tz} />
      ) : null}

      <div className={`booking-detail-content-grid${nextSteps.length ? '' : ' booking-detail-content-grid--single'}`}>
        <BookingDetailLessonSection booking={booking} payment={payment} tz={tz} isCoach={isCoach} admin={admin} />
        <BookingDetailNextStepsSection steps={nextSteps} />
      </div>

      {admin ? <AdminMoneyStateSection booking={booking} payment={payment} /> : null}

      {admin && booking.status === 'cancelled' ? (
        <section className="card stack booking-detail-section admin-section-card">
          <h2 className="booking-detail-section-title">Cancellation</h2>
          <dl className="booking-detail-facts">
            <div>
              <dt>Cancelled by</dt>
              <dd>{booking.cancelled_by || '—'}</dd>
            </div>
            <div>
              <dt>Cancelled at</dt>
              <dd>{booking.cancelled_at ? formatInZone(booking.cancelled_at, tz) : '—'}</dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd>{adminRefundStatusView(payment).value}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="card stack booking-detail-section booking-detail-actions">
        <h2 className="booking-detail-section-title">{admin ? 'Admin actions' : 'Booking actions'}</h2>
        {messagingLockedCopy(booking) ? (
          <p className="small muted" style={{ margin: 0 }}>{messagingLockedCopy(booking)}</p>
        ) : null}
        {bookingActions}
      </section>
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
        <Link to={admin ? '/admin/bookings' : (isCoach ? '/coach/bookings' : '/bookings')}>Back to list</Link>
      </p>
    </div>
  );
}

function CoachIssueReportedPanel({ booking, tz }) {
  const now = useNow(15000);
  const review = booking?.financial_review;
  const remaining = review?.review_until
    ? formatRemainingUntil(review.review_until, new Date(now))
    : null;
  const untilLabel = review?.review_until ? formatInZone(review.review_until, tz) : null;
  const stillOpen = remaining && remaining !== 'ended';
  const openedBy = booking?.active_issue?.opened_by;
  const body = booking.status === 'disputed' && !hasOpenIssueReport(booking)
    ? 'A payment dispute is open on this booking. Payout is blocked while it is under review.'
    : openedBy === 'coach'
      ? 'You reported an issue with this lesson. Payout is blocked while the issue is under review.'
      : 'The student reported an issue with this lesson. Payout is blocked while the issue is under review.';

  return (
    <Alert tone="warning">
      <strong>Issue reported</strong>
      <div style={{ marginTop: 6 }}>{body}</div>
      {stillOpen && untilLabel ? (
        <div className="small" style={{ marginTop: 10 }}>
          <strong>Financial review window:</strong> {remaining} remaining
          <div className="muted">Until {untilLabel}</div>
        </div>
      ) : untilLabel ? (
        <div className="small muted" style={{ marginTop: 10 }}>
          Financial review window ended {untilLabel}. Payout remains blocked while the issue is open.
        </div>
      ) : null}
    </Alert>
  );
}

function FinancialReviewBanner({ booking, isCoach, isStudent, tz }) {
  const now = useNow(15000);
  const review = booking?.financial_review;
  if (!review?.review_until) return null;
  if (!isPostLessonReviewEligible(booking, now)) return null;
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
    // Students with an open issue: no financial-window countdown (dispute blocks payout anyway).
    if (isStudent && (hasOpenIssueReport(booking) || booking.status === 'disputed')) {
      return null;
    }
    if (isStudent) {
      const copy = studentReviewWindowBannerCopy(booking, { remaining, deadlineFormatted: deadline }, now);
      return (
        <Alert tone={copy.tone}>
          <strong>{copy.title}</strong>
          {' '}{copy.body}
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
    if (isStudent && (hasOpenIssueReport(booking) || booking.status === 'disputed')) {
      return null;
    }
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
      <FormField label="Notes (optional)" name="dispute_notes">
        <>
          <textarea
            id="dispute_notes"
            name="dispute_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={CHAR_LIMITS.disputeNotes}
          />
          <CharacterCounter value={notes} max={CHAR_LIMITS.disputeNotes} />
        </>
      </FormField>
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
      <FormField label="Notes (optional)" name="reason_notes">
        <>
          <textarea
            id="reason_notes"
            name="reason_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={CHAR_LIMITS.cancelNotes}
          />
          <CharacterMaxHint max={CHAR_LIMITS.cancelNotes} />
        </>
      </FormField>
      <button className="btn danger" type="submit" disabled={busy}>Cancel booking</button>
    </form>
  );
}

function DeclineForm({ onSubmit, busy }) {
  const [message_to_student, setMessage] = useState('');
  const [decline_reason_code, setCode] = useState('availability_conflict');
  const trimmedMessage = message_to_student.trim();
  const messageReady = trimmedMessage.length >= CHAR_LIMITS.declineMessageMin;

  return (
    <form
      className="stack booking-decline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!messageReady) return;
        onSubmit({ message_to_student: trimmedMessage, decline_reason_code });
      }}
    >
      <h3 className="booking-decline-form-title" style={{ margin: 0, fontSize: '1rem' }}>Decline request</h3>
      <p className="small muted" style={{ margin: 0 }}>
        You&apos;re declining this lesson request. The student will be notified that you declined, and their
        payment authorization will be released. A short message helps the student understand why you
        couldn&apos;t accept.
      </p>
      <div className="alert info" role="status">
        <strong>Declining does not affect your reliability score.</strong>
      </div>
      <FormField label="Message to student — required" name="message_to_student" required>
        <>
          <p className="small muted" style={{ margin: '0 0 6px' }}>
            This is what the student reads in their notification. For example: &ldquo;I&apos;m not available
            at this time, but I&apos;d be happy to teach you another day.&rdquo;
          </p>
          <textarea
            id="message_to_student"
            name="message_to_student"
            value={message_to_student}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={CHAR_LIMITS.declineMessageMin}
            maxLength={CHAR_LIMITS.declineMessage}
            placeholder="Not available at this time — please choose another slot."
            rows={4}
          />
          <CharacterMaxHint max={CHAR_LIMITS.declineMessage} />
        </>
      </FormField>
      <FormField label="Reason" name="decline_reason_code">
        <>
          <p className="small muted" style={{ margin: '0 0 6px' }}>
            For PickleCoach records and reporting — not a substitute for your message above.
          </p>
          <select id="decline_reason_code" value={decline_reason_code} onChange={(e) => setCode(e.target.value)}>
            {DECLINE_REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </>
      </FormField>
      <button className="btn danger" type="submit" disabled={busy || !messageReady}>Decline request</button>
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
      <FormField label="Comment (optional)" name="comment">
        <>
          <textarea
            id="comment"
            name="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={CHAR_LIMITS.reviewComment}
          />
          <CharacterCounter value={comment} max={CHAR_LIMITS.reviewComment} />
        </>
      </FormField>
      <button className="btn secondary" type="submit" disabled={busy}>Submit review</button>
    </form>
  );
}

function AdminMoneyStateSection({ booking, payment }) {
  const moneyItems = adminBookingMoneyStatusItems({ booking, payment });
  const byKey = Object.fromEntries(moneyItems.map((item) => [item.key, item]));
  const refund = adminRefundStatusView(payment);
  return (
    <section className="card stack booking-detail-section admin-section-card">
      <h2 className="booking-detail-section-title">Money state</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Student charge, escrow, refund, and coach payout are separate. A charge must never end up both refunded and paid out.
      </p>
      <AdminStatusStack items={[...moneyItems, refund]} />
      <div className="admin-money-block">
        <div>
          <h3>Student payment</h3>
          <div>{formatMoney(payment?.total_charge_to_student ?? booking.price)}</div>
          <div className="small muted">
            Status: {byKey.payment?.value || '—'}
            {payment?.charge_id ? ` · Charge ${payment.charge_id}` : ''}
          </div>
        </div>
        <div>
          <h3>Platform / escrow</h3>
          <div className="small">
            Expected coach payout {formatMoney(payment?.coach_payout_expected)}
            {payment?.platform_fee_amount != null ? ` · Platform fee ${formatMoney(payment.platform_fee_amount)}` : ''}
          </div>
          <div className="small muted">Escrow: {byKey.escrow?.value || '—'}</div>
        </div>
        <div>
          <h3>Coach payout</h3>
          <div className="small muted">
            {byKey.payout?.value || '—'}
            {payment?.transfer_id ? ` · Transfer ${payment.transfer_id}` : ''}
          </div>
        </div>
        <div>
          <h3>Refund</h3>
          <div className="small muted">
            {refund.value}
            {payment?.refunded_amount != null && Number(payment.refunded_amount) > 0
              ? ` · ${formatMoney(payment.refunded_amount)}`
              : ''}
          </div>
        </div>
      </div>
      {booking.active_issue?.id ? (
        <p className="small">
          Open issue:{' '}
          <Link to={`/admin/disputes/${booking.active_issue.id}`}>Dispute #{booking.active_issue.id}</Link>
        </p>
      ) : null}
    </section>
  );
}

function AdminBookingActions({ id, busy, run }) {
  return (
    <div className="stack admin-actions-card" style={{ padding: '0.85rem', borderRadius: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Destructive money actions require confirmation. Prefer the dispute resolve API for open issue cases.
      </p>
      <button
        className="btn secondary"
        type="button"
        disabled={busy}
        onClick={() => {
          const ok = window.confirm(
            'Issue a refund for this booking?\n\nThis uses the admin refund endpoint and should not be used if a payout has already been sent.',
          );
          if (!ok) return;
          run(() => adminApi.refundBooking(id, { reason: 'requested_by_customer' }), 'Refund submitted.');
        }}
      >
        Refund
      </button>
      <CancelForm busy={busy} onSubmit={(body) => run(() => adminApi.cancelBooking(id, body), 'Admin cancelled.')} />
    </div>
  );
}
