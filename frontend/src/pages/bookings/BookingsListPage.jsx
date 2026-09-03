import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { studentsApi, coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { BookingListCardBody } from '../../components/bookings/BookingListCardBody.jsx';
import {
  bookingStatusLabel,
  bookingDisplayLabel,
  bookingDisplayTone,
  coachAcceptanceDeadlineAt,
  isPostLessonReviewEligible,
  sortBookingsForList,
} from '../../domain/bookingStatus.js';
import { formatListWhenInZone, formatRemainingUntil } from '../../utils/datetime.js';

export function BookingsListPage({ audience = 'student' }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tz = user?.timezone;

  const { data, error, loading } = useAsync(async () => {
    const query = status ? { status } : {};
    const res = audience === 'coach'
      ? await coachesApi.myBookings(query)
      : await studentsApi.myBookings(query);
    return sortBookingsForList(asList(res.data), undefined, { audience });
  }, [audience, status, user?.id]);

  function setStatus(next) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('status', next);
    else nextParams.delete('status');
    setParams(nextParams);
  }

  const title = audience === 'coach' ? 'Lesson requests & schedule' : 'My bookings';

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {['', 'pending', 'confirmed', 'completed', 'cancelled'].map((s) => (
          <button key={s || 'all'} type="button" className={`btn ${status === s ? '' : 'secondary'}`} onClick={() => setStatus(s)}>
            {s ? bookingStatusLabel(s, { audience }) : 'All'}
          </button>
        ))}
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && (!data || data.length === 0) ? (
        <EmptyState
          title={
            status === 'pending'
              ? 'No pending bookings'
              : status
                ? `No ${bookingStatusLabel(status, { audience }).toLowerCase()} bookings`
                : (audience === 'coach' ? 'No lesson requests yet' : 'No bookings yet')
          }
          detail={
            status === 'pending' && audience === 'coach'
              ? 'You don’t have any lesson requests waiting for a response.'
              : status === 'pending'
                ? 'When you request a lesson, it stays here until the coach accepts, declines, or the deadline passes.'
                : !status && audience === 'student'
                  ? 'Find a coach and book your first lesson.'
                  : audience === 'coach'
                    ? 'Incoming requests and your upcoming lessons will show up here.'
                    : 'Your next lesson will appear here after you book one.'
          }
        />
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
                  lessonTitle={b.lesson?.title || 'Lesson'}
                  partyName={other?.full_name}
                  price={b.price}
                  lessonWhen={formatListWhenInZone(b.scheduled_at, tz)}
                  requestedWhen={b.created_at ? formatListWhenInZone(b.created_at, tz) : null}
                  deadlineWhen={deadlineIso ? formatListWhenInZone(deadlineIso, tz) : null}
                  audience={audience}
                >
                  {audience === 'coach' && b.financial_review?.window_open && isPostLessonReviewEligible(b) ? (
                    <div className="small" style={{ marginTop: 8 }}>
                      <StatusBadge status="review" label={`${formatRemainingUntil(b.financial_review.review_until)} left to report`} tone="info" />
                    </div>
                  ) : null}
                </BookingListCardBody>
                <StatusBadge
                  status={b.status}
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
