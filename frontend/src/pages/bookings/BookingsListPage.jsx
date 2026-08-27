import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { studentsApi, coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { bookingStatusLabel, bookingStatusTone, coachAcceptanceDeadlineAt } from '../../domain/bookingStatus.js';
import { formatInZone, formatDateInZone, formatTimeInZone, formatRemainingUntil } from '../../utils/datetime.js';
import { formatMoney } from '../../utils/format.js';

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
    return asList(res.data);
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
              ? (audience === 'coach' ? 'No pending booking requests' : 'No pending booking requests')
              : status
                ? `No ${bookingStatusLabel(status, { audience }).toLowerCase()} bookings`
                : (audience === 'coach' ? 'No lesson requests yet' : 'No bookings yet')
          }
          detail={
            status === 'pending' && audience === 'coach'
              ? 'You’ll see new requests here when a student books a lesson with you.'
              : status === 'pending'
                ? 'When you request a lesson, it stays here until the coach accepts, declines, or the deadline passes.'
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
          const deadlineLabel = deadlineIso
            ? `${formatDateInZone(deadlineIso, tz)} · ${formatTimeInZone(deadlineIso, tz)}`
            : null;
          return (
            <Link key={b.id} to={`/bookings/${b.id}`} className="card clickable" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="spread">
                <div>
                  <strong>{b.lesson?.title || 'Lesson'}</strong>
                  <div className="small muted">
                    {other?.full_name || '—'} · {formatInZone(b.scheduled_at, tz)} · {formatMoney(b.price)}
                  </div>
                  {deadlineLabel ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      {audience === 'coach'
                        ? <strong>Respond by {deadlineLabel}</strong>
                        : <>Coach has until {deadlineLabel}</>}
                    </div>
                  ) : null}
                  {b.financial_review?.window_open ? (
                    <div className="small" style={{ marginTop: 4 }}>
                      <StatusBadge status="review" label={`${formatRemainingUntil(b.financial_review.review_until)} left to report`} tone="info" />
                    </div>
                  ) : null}
                </div>
                <StatusBadge
                  status={b.status}
                  label={bookingStatusLabel(b.status, { audience })}
                  tone={bookingStatusTone(b.status)}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
