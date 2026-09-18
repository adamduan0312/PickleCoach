import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { bookingsApi, messagesApi, reviewsApi, adminApi, disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { StarRating, StarRatingInput } from '../../components/ui/StarRating.jsx';
import { CharacterCounter, CharacterMaxHint } from '../../components/ui/CharacterLimit.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { hasAdminRole } from '../../domain/userReadiness.js';
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
  lessonAmountLabel,
  coachCancelMoneyPresentation,
  studentCoachCancelMoneyPresentation,
  isStudentPaymentRefunded,
  isCoachPayoutReleased,
  isCoachPayoutNotDue,
  cancelMoneyConsequenceCopy,
  cancelledOutcomeCopy,
  bookingOutcomeCopy,
  messagingLockedCopy,
  hasLessonEnded,
  isPostLessonReviewEligible,
  isFinancialReviewWindowOpen,
  studentReviewWindowBannerCopy,
  confirmedStudentNoShowReminder,
  studentNoShowConfirmTitle,
  studentNoShowConfirmBody,
  CANCEL_REASONS,
  DECLINE_REASON_CODES,
  cancellationHistoryEventLabel,
  cancellationHistoryReasonDisplay,
} from '../../domain/bookingStatus.js';
import {
  coachPayoutLabel,
  issueResolutionFacts,
} from '../../domain/issueResolutionDisplay.js';
import {
  bookingSettlementDisplayRows,
  bookingSettlementFacts,
} from '../../domain/bookingSettlementDisplay.js';
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

function bookingDetailHeadline(booking, { audience }) {
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    return booking.status === 'disputed' && !hasOpenIssueReport(booking)
      ? 'Payment dispute under review'
      : 'Issue reported';
  }
  if (booking.status === 'pending') {
    return audience === 'coach' ? 'Response needed' : 'Booking requested';
  }
  if (booking.status === 'confirmed') return 'Booking confirmed';
  if (booking.status === 'awaiting_verification') {
    return audience === 'coach' ? 'Confirm lesson attendance' : 'Awaiting confirmation';
  }
  if (booking.status === 'completed') return 'Lesson complete';
  if (booking.status === 'cancelled') return 'Booking cancelled';
  return bookingStatusLabel(booking.status, { audience });
}

function bookingDetailLead(booking, { audience, tz, now = Date.now(), payment = null }) {
  const coachName = booking.coach?.full_name || 'the coach';
  const studentName = booking.primaryStudent?.full_name || 'the student';
  const deadlineLabel = formatAcceptanceDeadline(coachAcceptanceDeadlineAt(booking), tz);
  const reviewOpen = isFinancialReviewWindowOpen(booking, now);

  // Issue messaging lives in IssueReportedPanel (avoids triple repeat).
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
    return null;
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
        ? 'The lesson time has passed. Please confirm whether the lesson took place.'
        : 'The lesson time has passed. Your coach is confirming whether the lesson took place.';
    case 'completed':
      if (booking.resolved_issue?.id) {
        return 'The lesson was completed. An issue was reported and reviewed.';
      }
      if (audience === 'coach') {
        return reviewOpen
          ? 'The lesson has been marked complete. The 24-hour issue-reporting period is still open.'
          : 'The lesson has been marked complete. The issue-reporting period has ended.';
      }
      return reviewOpen
        ? 'Your coach marked the lesson complete. You have 24 hours to report an issue.'
        : 'Your coach marked the lesson complete. The issue-reporting period has ended.';
    case 'cancelled':
      return cancelledOutcomeCopy(booking, { audience, payment });
    case 'student_no_show':
    case 'coach_no_show':
      return null;
    default:
      return null;
  }
}

function bookingDetailNextSteps(booking, { audience, tz, now = Date.now(), payment = null }) {
  const deadlineLabel = formatAcceptanceDeadline(coachAcceptanceDeadlineAt(booking), tz);
  const whenLabel = `${formatDateInZone(booking.scheduled_at, tz)} · ${formatTimeInZone(booking.scheduled_at, tz)}`;
  const reviewOpen = isFinancialReviewWindowOpen(booking, now);

  // Open issue / payment dispute: IssueReportedPanel owns the primary message.
  if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
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
            body: 'Payment is held for 24 hours after the lesson so either side can report an issue.',
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
          body: 'The review and issue-reporting window opens for 24 hours. Payment is not finalized until it closes.',
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
            body: 'Confirming attendance does not release payment. Either side can report an issue during the 24-hour review window.',
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
      if (audience === 'student') {
        const steps = [];
        if (!booking.student_review) {
          steps.push({
            title: 'Leave a review',
            body: 'Tell other students about your experience with this coach.',
          });
        }
        if (reviewOpen) {
          steps.push({
            title: 'Report a problem if needed',
            body: 'If something went wrong, report an issue before the issue-reporting period closes.',
          });
        } else if (isStudentPaymentRefunded(payment) || isCoachPayoutNotDue(booking, payment)) {
          steps.push({
            title: 'Financial outcome',
            body: isStudentPaymentRefunded(payment)
              ? 'The lesson was marked complete, then this booking was refunded. No payment is due to the coach. Nothing else is required from you.'
              : 'This booking is financially final. Nothing else is required from you.',
          });
        } else if (isCoachPayoutReleased(booking)) {
          steps.push({
            title: 'Payment released',
            body: 'The issue-reporting period ended and your payment was finalized with the coach.',
          });
        } else {
          steps.push({
            title: 'Financial outcome',
            body: 'This booking is financially final. You can still view the lesson details.',
          });
        }
        return steps;
      }
      if (reviewOpen) {
        return [
          {
            title: 'Payout timing',
            body: 'Your payout will be released after the 24-hour issue-reporting period if no issue is reported.',
          },
        ];
      }
      if (isCoachPayoutReleased(booking)) {
        return [
          {
            title: 'Payment released',
            body: 'The issue-reporting period ended and your payout has been released.',
          },
        ];
      }
      if (isCoachPayoutNotDue(booking, payment)) {
        return [
          {
            title: 'No payout due',
            body: isStudentPaymentRefunded(payment)
              ? 'The lesson was completed, but the reported issue was reviewed and resolved with a refund. No payout is due.'
              : 'No payout is due for this booking.',
          },
        ];
      }
      return [
        {
          title: 'Payout timing',
          body: 'The issue-reporting period has ended. Payout follows the normal settlement process if no issue was reported.',
        },
      ];
    case 'student_no_show':
    case 'coach_no_show':
      if (audience === 'student') {
        if (reviewOpen) {
          return [
            {
              title: 'Report a problem if needed',
              body: 'If this outcome is incorrect, report an issue before the issue-reporting period closes.',
            },
          ];
        }
        return [
          {
            title: 'Issue-reporting period closed',
            body: booking.status === 'student_no_show'
              ? 'The issue-reporting window for this no-show has ended. No further issues can be reported for this booking.'
              : 'The issue-reporting window for this lesson has ended. No further issues can be reported for this booking.',
          },
        ];
      }
      // Coach
      if (booking.status === 'coach_no_show') {
        return [
          {
            title: 'No payout due',
            body: 'This booking was resolved as a coach no-show. No payout is due.',
          },
        ];
      }
      // student_no_show — coach
      if (reviewOpen) {
        return [
          {
            title: 'Payout timing',
            body: 'Your payout will be released after the 24-hour issue-reporting period if no issue is reported.',
          },
        ];
      }
      if (isCoachPayoutReleased(booking)) {
        return [
          {
            title: 'Payment released',
            body: 'The issue-reporting period ended and your payout has been released.',
          },
        ];
      }
      if (isCoachPayoutNotDue(booking, payment)) {
        return [
          {
            title: 'Settlement',
            body: isStudentPaymentRefunded(payment)
              ? 'This booking was refunded and no coach payout is due.'
              : 'No coach payout is due for this booking.',
          },
        ];
      }
      return [
        {
          title: 'Payout timing',
          body: 'The issue-reporting period has ended. Payout follows the normal settlement process if no issue was reported.',
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
  const coachCancelMoney = isCoach && !admin
    ? coachCancelMoneyPresentation(booking, payment)
    : null;
  const studentCancelMoney = !isCoach && !admin
    ? studentCoachCancelMoneyPresentation(booking, payment)
    : null;
  const amountLabel = coachCancelMoney?.amountLabel
    || studentCancelMoney?.amountLabel
    || lessonAmountLabel(payment, booking);
  const paymentStatus = coachCancelMoney
    ? coachCancelMoney.paymentStatusLine
    : (studentCancelMoney
      ? studentCancelMoney.paymentStatusLine
      : paymentStatusLabel(payment));
  const whereLabel = courtLabel(booking.courtLocation);
  const showCoachPayout = isCoach && (coachCancelMoney || payment?.coach_payout_expected != null);
  const payoutLabel = coachCancelMoney?.payoutLabel || 'Expected payout';
  let payoutDisplay = null;
  if (coachCancelMoney?.payoutKind === 'not_payable') payoutDisplay = 'Not payable';
  else if (coachCancelMoney?.payoutKind === 'zero') payoutDisplay = formatMoney(0);
  else if (payment?.coach_payout_expected != null) payoutDisplay = formatMoney(payment.coach_payout_expected);

  let refundDisplay = null;
  if (studentCancelMoney?.showRefund) {
    if (studentCancelMoney.refundValueKind === 'amount' && studentCancelMoney.refundValueAmount != null) {
      refundDisplay = `${formatMoney(studentCancelMoney.refundValueAmount)} refunded`;
    } else if (studentCancelMoney.refundValueText) {
      refundDisplay = studentCancelMoney.refundValueText;
    }
  }

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
        {refundDisplay ? (
          <div className="booking-detail-facts-payment">
            <dt>{studentCancelMoney.refundLabel}</dt>
            <dd>
              {refundDisplay}
              {studentCancelMoney.refundStatusLine ? (
                <span className="small muted booking-detail-payment-status">
                  {studentCancelMoney.refundStatusLine}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {showCoachPayout && payoutDisplay != null ? (
          <div className="booking-detail-facts-full">
            <dt>{payoutLabel}</dt>
            <dd>{payoutDisplay}</dd>
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
  const { user, mode } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pageTopRef = useRef(null);
  // Keep report-issue / review-window UI in sync with the countdown (banner ticks alone would not re-render actions).
  const now = useNow(15000);

  const adminSharedRedirect = !admin && mode === 'admin' && hasAdminRole(user?.roles) && id
    ? `/admin/bookings/${id}`
    : null;

  const { data, error: loadError, loading, setData } = useAsync(async () => {
    if (adminSharedRedirect) return null;
    const res = admin ? await adminApi.booking(id) : await bookingsApi.getById(id);
    return res.data;
  }, [id, admin, adminSharedRedirect]);

  if (adminSharedRedirect) {
    return <Navigate to={adminSharedRedirect} replace />;
  }

  const booking = data;
  const tz = user?.timezone || detectLocalTimezone();
  const isCoach = booking && user?.id === booking.coach_id;
  const isStudent = booking && user?.id === booking.primary_student_id;
  const payments = booking?.payments || (booking?.payment ? [booking.payment] : []);
  const payment = payments[0];
  const audience = isCoach ? 'coach' : isStudent ? 'student' : undefined;

  async function run(action, successMsg = null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      const res = admin ? await adminApi.booking(id) : await bookingsApi.getById(id);
      // Commit the updated booking UI before scrolling so the user lands on the new status.
      flushSync(() => {
        setData(res.data);
        if (successMsg) setMessage(successMsg);
      });
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      pageTopRef.current?.focus({ preventScroll: true });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openMessages() {
    setBusy(true);
    setError(null);
    try {
      let conversationId = booking.conversation?.id;
      // Locked bookings: view existing history only — never create a new thread.
      if (!conversationId && !booking.messaging_locked) {
        const created = await messagesApi.createConversation(booking.id);
        conversationId = created.data?.id;
      }
      if (conversationId) navigate(`/messages/${conversationId}`);
      else if (booking.messaging_locked) {
        setError('There are no messages for this booking.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><LoadingState /></div>;
  if (loadError) return <div className="page"><ErrorState error={loadError} /></div>;
  if (!booking) return <div className="page"><EmptyState title="Booking not found" /></div>;

  const canOpenConversation = !booking.messaging_locked;
  const canViewConversation = Boolean(booking.conversation?.id);
  const bookingActions = (
    <>
      {canOpenConversation ? (
        <button className="btn secondary" type="button" disabled={busy} onClick={openMessages}>
          Open conversation
        </button>
      ) : canViewConversation ? (
        <button className="btn secondary" type="button" disabled={busy} onClick={openMessages}>
          View messages
        </button>
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
        <DeclineForm busy={busy} onSubmit={(body) => run(() => bookingsApi.decline(id, body))} />
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
          Complete and no-show confirm attendance only. They do not release payment. Both sides have 24 hours after the lesson to report an issue.
        </p>
      ) : null}
      {isCoach && canCoachComplete(booking) ? (
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => {
            const ok = window.confirm(
              'Mark this lesson complete? This confirms attendance only. It does not release payment. Both sides have 24 hours after the lesson to report an issue before payment is normally finalized.',
            );
            if (!ok) return;
            run(() => bookingsApi.complete(id, {}));
          }}
        >
          Mark lesson complete
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
            run(() => bookingsApi.studentNoShow(id, {}));
          }}
        >
          Student no-show
        </button>
      ) : null}
      {(isStudent && canStudentCancel(booking)) || (isCoach && canCoachCancel(booking)) ? (
        <CancelForm
          busy={busy}
          consequence={cancelMoneyConsequenceCopy(booking, payment, { audience: isCoach ? 'coach' : 'student' })}
          onSubmit={(body) => run(() => bookingsApi.cancel(id, body))}
        />
      ) : null}
      {admin ? <AdminBookingActions id={id} busy={busy} run={run} /> : null}
      {(isStudent || isCoach) && canReportLessonIssue(booking, now) ? (
        <ReportIssueForm
          booking={booking}
          isCoach={isCoach}
          busy={busy}
          now={now}
          onSubmit={(body) => run(() => disputesApi.create(body))}
        />
      ) : null}
      {['pending', 'confirmed'].includes(booking.status) ? (
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
    : bookingDetailLead(booking, { audience: audience || 'student', tz, now, payment });
  const nextSteps = admin ? [] : bookingDetailNextSteps(booking, {
    audience: audience || 'student',
    tz,
    now,
    payment,
  });
  const adminStatusItems = admin
    ? [...adminBookingMoneyStatusItems({ booking, payment }), adminRefundStatusView(payment)]
    : null;

  return (
    <div className="page booking-detail-page" ref={pageTopRef} tabIndex={-1}>
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
            status={hasOpenIssueReport(booking) || booking.status === 'disputed' ? 'issue' : booking.status}
            label={bookingDisplayLabel(booking, { audience })}
            tone={bookingDisplayTone(booking)}
          />
        )}
      </div>

      {/* Flash only for actions that don't rewrite the page headline (e.g. accept, review). */}
      <Alert tone="success">{message}</Alert>

      {!admin && (hasOpenIssueReport(booking) || booking.status === 'disputed') ? (
        <IssueReportedPanel
          booking={booking}
          audience={audience || 'student'}
        />
      ) : null}
      {!admin && !hasOpenIssueReport(booking)
        && ['student_no_show', 'coach_no_show'].includes(booking.status)
        && bookingOutcomeCopy(booking, { audience, now }) ? (
        <Alert tone="info">
          {bookingOutcomeCopy(booking, { audience, now })}
        </Alert>
      ) : null}
      {!admin ? (
        <FinancialReviewBanner
          booking={booking}
          payment={payment}
          isCoach={isCoach}
          isStudent={isStudent}
          tz={tz}
          now={now}
        />
      ) : null}

      {!admin && (isStudent || isCoach) && booking.resolved_issue?.id && !hasOpenIssueReport(booking) ? (
        <IssueResolvedPanel booking={booking} payment={payment} />
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

      {isStudent && booking.status === 'completed' ? (
        <section className="card stack booking-detail-section booking-review-section">
          {booking.student_review ? (
            <SubmittedStudentReview review={booking.student_review} audience="student" />
          ) : (
            <ReviewForm
              bookingId={booking.id}
              busy={busy}
              onSubmit={(body) => run(() => reviewsApi.create(body), 'Review submitted.')}
            />
          )}
        </section>
      ) : null}

      {isCoach && booking.status === 'completed' && booking.student_review ? (
        <section className="card stack booking-detail-section booking-review-section">
          <SubmittedStudentReview review={booking.student_review} audience="coach" />
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
        <section className="card stack booking-detail-section booking-cancellation-history">
          <h2 className="booking-detail-section-title">Cancellation history</h2>
          <ul className="booking-cancellation-history-list">
            {booking.cancellationHistory.map((row) => {
              const eventLabel = cancellationHistoryEventLabel(row, { audience });
              const reason = cancellationHistoryReasonDisplay(row);
              return (
                <li key={row.id} className="booking-cancellation-history-item">
                  <p className="booking-cancellation-history-event">{eventLabel}</p>
                  {reason ? (
                    <p className="muted booking-cancellation-history-reason">
                      Reason: {reason.primary}
                      {reason.detail ? ` — ${reason.detail}` : ''}
                    </p>
                  ) : null}
                  {row.cancelled_at ? (
                    <p className="small muted booking-cancellation-history-time">
                      <time dateTime={row.cancelled_at}>
                        {formatInZone(row.cancelled_at, tz, { weekday: undefined })}
                      </time>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p className="small" style={{ marginTop: 16 }}>
        <Link to={admin ? '/admin/bookings' : (isCoach ? '/coach/bookings' : '/bookings')}>Back to list</Link>
      </p>
    </div>
  );
}

function IssueResolvedPanel({ booking, payment }) {
  const issue = booking?.resolved_issue;
  if (!issue?.id) return null;
  const facts = issueResolutionFacts(issue);
  const settlement = bookingSettlementFacts(booking, payment, issue);
  const settlementRows = bookingSettlementDisplayRows(settlement);

  return (
    <Alert tone="info">
      <strong>Issue resolved</strong>
      <dl className="booking-detail-facts" style={{ marginTop: 10, marginBottom: 0 }}>
        {facts.decision ? (
          <div>
            <dt>Decision</dt>
            <dd>{facts.decision}</dd>
          </div>
        ) : null}
        {facts.financial ? (
          <div>
            <dt>Dispute financial action</dt>
            <dd>{facts.financial}</dd>
          </div>
        ) : null}
        {facts.reliability ? (
          <div>
            <dt>Reliability</dt>
            <dd>{facts.reliability}</dd>
          </div>
        ) : null}
        {facts.attendance ? (
          <div>
            <dt>Attendance finding</dt>
            <dd>{facts.attendance}</dd>
          </div>
        ) : null}
      </dl>
      {settlementRows.length ? (
        <>
          <strong style={{ display: 'block', marginTop: 12 }}>{settlement.settlementHeadline}</strong>
          <dl className="booking-detail-facts" style={{ marginTop: 8, marginBottom: 0 }}>
            {settlementRows.map((row) => (
              <div key={row.dt}>
                <dt>{row.dt}</dt>
                <dd>{row.dd}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <div style={{ marginTop: 10 }}>
        <Link className="btn secondary" to={`/issues/${issue.id}`}>
          View resolution details
        </Link>
      </div>
    </Alert>
  );
}

function IssueReportedPanel({ booking, audience }) {
  const openedBy = booking?.active_issue?.opened_by;
  const isChargeback = booking.status === 'disputed' && !hasOpenIssueReport(booking);

  let body;
  if (isChargeback) {
    body = audience === 'coach'
      ? 'This booking has a payment dispute. Payout is on hold until it is resolved.'
      : 'Your payment is under review as part of a payment dispute. We\'ll update you when there\'s an outcome.';
  } else if (audience === 'coach') {
    body = openedBy === 'coach'
      ? 'You reported an issue with this lesson. We\'re reviewing it. Your payout is on hold while the issue is open.'
      : 'The student reported an issue with this lesson. We\'re reviewing it. Your payout is on hold while the issue is open.';
  } else if (openedBy === 'coach') {
    body = 'The coach reported an issue with this lesson. We\'re reviewing it. Settlement is on hold while the issue is open.';
  } else {
    body = 'You reported an issue with this lesson. We\'re reviewing it. Settlement is on hold while the issue is open.';
  }

  const title = isChargeback
    ? 'Payment dispute under review'
    : 'Issue reported';

  const lessonStatusLabel = bookingStatusLabel(booking.status, { audience });
  const showSeparateStatuses = !isChargeback && hasOpenIssueReport(booking);

  return (
    <Alert tone="warning">
      <strong>{title}</strong>
      <div style={{ marginTop: 6 }}>{body}</div>
      {showSeparateStatuses ? (
        <dl className="booking-detail-facts" style={{ marginTop: 10, marginBottom: 0 }}>
          <div>
            <dt>Lesson status</dt>
            <dd>{lessonStatusLabel}</dd>
          </div>
          <div>
            <dt>Issue status</dt>
            <dd>Under review</dd>
          </div>
        </dl>
      ) : null}
      {!isChargeback && booking?.active_issue?.id ? (
        <div style={{ marginTop: 10 }}>
          <Link className="btn secondary" to={`/issues/${booking.active_issue.id}`}>
            View issue details
          </Link>
        </div>
      ) : null}
    </Alert>
  );
}

function FinancialReviewBanner({ booking, payment, isCoach, isStudent, tz, now: nowProp }) {
  const now = nowProp ?? Date.now();
  const review = booking?.financial_review;
  if (!review?.review_until) return null;
  if (!isPostLessonReviewEligible(booking, now)) return null;

  const lessonEnded = review.lesson_ended_at
    ? new Date(review.lesson_ended_at).getTime() <= now
    : hasLessonEnded(booking, now);
  const windowOpen = isFinancialReviewWindowOpen(booking, now);
  // Before lesson end with no open window: hide. After lesson end, show open or closed copy.
  if (!lessonEnded && !windowOpen) return null;

  const deadline = formatInZone(review.review_until, tz);
  const remaining = formatRemainingUntil(review.review_until, new Date(now));
  const stillOpen = windowOpen && remaining !== 'ended';
  const payoutPaid = isCoachPayoutReleased(booking);
  const escrowManual = String(payment?.escrow_status || '').toLowerCase() === 'manual_payout_required';

  // Coach payout sent — only after the issue-reporting opportunity is over.
  // Never claim "released" when escrow is parked for manual review.
  if (payoutPaid && !stillOpen && !escrowManual) {
    return (
      <Alert tone="success">
        <strong>Payment released.</strong>
        {' '}
        {isStudent
          ? 'The issue-reporting period ended and your payment was finalized with the coach.'
          : 'The issue-reporting period ended and your payout has been released.'}
        {' '}Exceptional corrections after this point require support.
      </Alert>
    );
  }

  if (stillOpen) {
    // Open issue / chargeback: IssueReportedPanel owns messaging (no review-window countdown).
    if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
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
          <strong>Payout is protected for 24 hours after the lesson.</strong>
          {' '}Your payout will be released after the issue-reporting period if no issue is reported.
          {' '}<strong>Time remaining: {remaining}</strong>
          <div className="small muted" style={{ marginTop: 6 }}>Until {deadline}</div>
        </Alert>
      );
    }
    return (
      <Alert tone="info">
        Issue-reporting period: <strong>{remaining}</strong> left (until {deadline}). Payment is not released until this ends.
      </Alert>
    );
  }

  if (lessonEnded) {
    if (hasOpenIssueReport(booking) || booking.status === 'disputed') {
      return null;
    }
    const payout = coachPayoutLabel(booking, payment);
    if (payout === 'Failed — manual review') {
      return (
        <Alert tone="warning">
          <strong>Settlement failed — manual review required.</strong>
          {' '}
          Coach payout could not be completed automatically
          {payment?.coach_payout_expected != null
            ? ` (${formatMoney(payment.coach_payout_expected)} expected)`
            : ''}
          .
          {' '}Ended {deadline}.
        </Alert>
      );
    }
    if (payout === 'None due' || payout === 'Pending' || payout === 'Paid') {
      return (
        <Alert tone="info">
          <strong>The issue-reporting period has closed.</strong>
          {' '}
          <span>
            Coach payout: {payout === 'Paid' ? 'complete' : payout.toLowerCase()}.
          </span>
          {' '}Ended {deadline}.
        </Alert>
      );
    }
    return (
      <Alert tone="info">
        <strong>The issue-reporting period has closed.</strong>
        {' '}This booking is normally financially final.
        {' '}Ended {deadline}. Exceptional corrections may require support.
      </Alert>
    );
  }
  return null;
}

function ReportIssueForm({ booking, isCoach, busy, onSubmit, now = Date.now() }) {
  const { data: types } = useAsync(async () => asList((await disputesApi.types()).data), []);
  const allowedCodes = isCoach
    ? ['misconduct', 'lesson_not_completed', 'other']
    : ['coach_no_show_claim', 'misconduct', 'lesson_not_completed', 'other'];
  const options = (types || []).filter((t) => allowedCodes.includes(t.code));
  const optionIdsKey = options.map((t) => t.id).join(',');
  const [disputeTypeId, setDisputeTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const remaining = formatRemainingUntil(booking.financial_review?.review_until, new Date(now));

  useEffect(() => {
    if (!options.length) {
      setDisputeTypeId((prev) => (prev ? '' : prev));
      return;
    }
    setDisputeTypeId((prev) => {
      if (prev && options.some((t) => String(t.id) === String(prev))) return prev;
      return String(options[0].id);
    });
  }, [optionIdsKey]);

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
        You have until {formatInZone(booking.financial_review?.review_until)} ({remaining} left) to report a payment or lesson problem before this booking is normally finalized.
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

function SubmittedStudentReview({ review, audience = 'student' }) {
  const rating = Number(review?.rating);
  const comment = typeof review?.comment === 'string' ? review.comment.trim() : '';
  const forCoach = audience === 'coach';
  return (
    <>
      <h2 className="booking-detail-section-title">{forCoach ? 'Student review' : 'Your review'}</h2>
      <StarRating
        rating={rating}
        label={forCoach ? `Student rated ${rating} out of 5` : `You rated ${rating} out of 5`}
      />
      {comment ? <p className="booking-review-comment">{comment}</p> : null}
      <p className="small muted booking-review-hint">{forCoach ? 'Submitted by student' : 'Submitted'}</p>
    </>
  );
}

function ReviewForm({ bookingId, onSubmit, busy }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const hasRating = rating >= 1 && rating <= 5;

  return (
    <>
      <h2 className="booking-detail-section-title">Leave a review</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hasRating) return;
          const trimmed = comment.trim();
          onSubmit({
            booking_id: Number(bookingId),
            rating: Number(rating),
            ...(trimmed ? { comment: trimmed } : {}),
          });
        }}
      >
        <FormField label="How was your lesson?" name="rating" required>
          <>
            <StarRatingInput id="rating" value={rating} onChange={setRating} disabled={busy} />
            <p className="small muted booking-review-hint">
              {hasRating ? `${rating} out of 5` : 'Select a rating'}
            </p>
          </>
        </FormField>
        <FormField label="Comment (optional)" name="comment">
          <>
            <textarea
              id="comment"
              name="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={CHAR_LIMITS.reviewComment}
              placeholder="Share what stood out about the lesson"
            />
            <CharacterCounter value={comment} max={CHAR_LIMITS.reviewComment} />
          </>
        </FormField>
        <button className="btn secondary" type="submit" disabled={busy || !hasRating}>
          Submit review
        </button>
      </form>
    </>
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
