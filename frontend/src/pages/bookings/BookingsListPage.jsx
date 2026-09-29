import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { studentsApi, coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { BookingListCardBody } from '../../components/bookings/BookingListCardBody.jsx';
import {
  bookingDisplayLabel,
  bookingDisplayTone,
  hasOpenIssueReport,
  coachAcceptanceDeadlineAt,
  isPostLessonReviewEligible,
  sortBookingsForList,
  STUDENT_BOOKING_LIST_FILTERS,
  COACH_BOOKING_LIST_FILTERS,
  bookingIncludedInListFilter,
  bookingListFilterLabel,
  isFinancialReviewWindowOpen,
} from '../../domain/bookingStatus.js';
import { formatListWhenInZone, formatListWhenWithZone, formatRemainingUntil } from '../../utils/datetime.js';
import { bookingLessonTitle } from '../../domain/lessonOffering.js';

function emptyStateCopy(audience, filter) {
  if (!filter) {
    return audience === 'coach'
      ? {
        title: 'No lesson requests yet',
        detail: 'Incoming requests and your upcoming lessons will show up here.',
      }
      : {
        title: 'No bookings yet',
        detail: 'Find a coach and book your first lesson.',
      };
  }

  if (audience === 'coach') {
    switch (filter) {
      case 'action_needed':
      case 'needs_attention':
        return {
          title: 'Nothing needs action',
          detail: 'Lesson requests, attendance confirmations, and open issues that need your attention will show up here.',
        };
      case 'upcoming':
        return {
          title: 'No upcoming lessons',
          detail: 'Confirmed lessons that haven’t happened yet will show up here.',
        };
      case 'completed':
        return {
          title: 'No completed lessons',
          detail: 'Lessons you mark complete will show up here.',
        };
      case 'cancelled':
        return {
          title: 'No cancelled bookings',
          detail: 'Cancelled, declined, and expired requests will show up here.',
        };
      default:
        break;
    }
  }
  if (audience === 'student') {
    switch (filter) {
      case 'awaiting_confirmation':
        return {
          title: 'No bookings awaiting confirmation',
          detail: 'Requests waiting for a coach response, and lessons waiting for attendance confirmation, will show up here.',
        };
      case 'upcoming':
        return {
          title: 'No upcoming lessons',
          detail: 'Confirmed lessons that haven’t happened yet will show up here.',
        };
      case 'completed':
        return {
          title: 'No completed lessons',
          detail: 'Completed lessons will show up here.',
        };
      case 'cancelled':
        return {
          title: 'No cancelled bookings',
          detail: 'Cancelled, declined, and expired requests will show up here.',
        };
      default:
        break;
    }
  }

  const label = bookingListFilterLabel(filter, { audience }).toLowerCase();
  return {
    title: `No ${label} bookings`,
    detail: audience === 'coach'
      ? 'Incoming requests and your upcoming lessons will show up here.'
      : 'Your next lesson will appear here after you book one.',
  };
}

export function BookingsListPage({ audience = 'student' }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tz = user?.timezone;
  const filterOptions = audience === 'coach'
    ? COACH_BOOKING_LIST_FILTERS
    : STUDENT_BOOKING_LIST_FILTERS;

  const { data, error, loading } = useAsync(async () => {
    // Grouped filters are client-side; always load the full inbox.
    const query = {};
    const res = audience === 'coach'
      ? await coachesApi.myBookings(query)
      : await studentsApi.myBookings(query);
    const sorted = sortBookingsForList(asList(res.data), undefined, { audience });
    return sorted.filter((b) => bookingIncludedInListFilter(b, status, { audience }));
  }, [audience, status, user?.id]);

  function setStatus(next) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('status', next);
    else nextParams.delete('status');
    setParams(nextParams);
  }

  const title = audience === 'coach' ? 'Lesson requests & schedule' : 'My bookings';
  const empty = emptyStateCopy(audience, status);

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {filterOptions.map(({ value, label }) => (
          <button
            key={value || 'all'}
            type="button"
            className={`btn ${status === value ? '' : 'secondary'}`}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && (!data || data.length === 0) ? (
        <EmptyState title={empty.title} detail={empty.detail} />
      ) : null}
      <div className="stack">
        {(data || []).map((b) => {
          const other = audience === 'coach' ? b.primaryStudent : b.coach;
          const deadlineIso = b.status === 'pending' ? coachAcceptanceDeadlineAt(b) : null;
          return (
            <Link
              key={b.id}
              to={`/bookings/${b.id}`}
              className="card clickable booking-list-card"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <div className="spread booking-list-card">
                <BookingListCardBody
                  lessonTitle={bookingLessonTitle(b)}
                  partyName={other?.full_name}
                  price={b.price}
                  lessonWhen={formatListWhenWithZone(b.scheduled_at, tz)}
                  requestedWhen={b.created_at ? formatListWhenInZone(b.created_at, tz) : null}
                  deadlineWhen={deadlineIso ? formatListWhenWithZone(deadlineIso, tz) : null}
                  audience={audience}
                >
                  {audience === 'coach'
                    && isFinancialReviewWindowOpen(b)
                    && isPostLessonReviewEligible(b)
                    && !hasOpenIssueReport(b)
                    && b.status !== 'disputed' ? (
                    <div className="small" style={{ marginTop: 8 }}>
                      <StatusBadge status="review" label={`${formatRemainingUntil(b.financial_review.review_until)} left to report`} tone="info" />
                    </div>
                  ) : null}
                </BookingListCardBody>
                <StatusBadge
                  status={hasOpenIssueReport(b) || b.status === 'disputed' ? 'issue' : b.status}
                  label={bookingDisplayLabel(b, { audience })}
                  tone={bookingDisplayTone(b)}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
