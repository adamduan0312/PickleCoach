import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, reviewsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import {
  adminReviewsListHint,
  sortAdminReviewsForList,
} from '../../domain/adminReviewList.js';
import { formatInZone } from '../../utils/datetime.js';

/**
 * Admin review inventory (GET /admin/reviews) with optional moderation delete via DELETE /reviews/:id.
 */
export function AdminReviewsPage() {
  const [params] = useSearchParams();
  const coachId = params.get('coach_id') || '';
  const studentId = params.get('student_id') || '';
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: 100 };
    if (coachId) query.coach_id = Number(coachId);
    if (studentId) query.student_id = Number(studentId);
    return asList((await adminApi.reviews(query)).data);
  }, [coachId, studentId, reloadTick]);

  const rows = useMemo(() => sortAdminReviewsForList(data || []), [data]);
  const listHint = useMemo(() => adminReviewsListHint(rows), [rows]);

  async function removeReview(id) {
    const ok = window.confirm(`Delete review #${id}? This cannot be undone from the admin UI.`);
    if (!ok) return;
    setBusyId(id);
    setActionError(null);
    setMessage(null);
    try {
      await reviewsApi.remove(id);
      setMessage(`Review #${id} deleted.`);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Reviews"
        subtitle="Most recent reviews first. No separate moderation state — delete when needed. Optional filters: ?coach_id= / ?student_id=."
      />

      {listHint && !loading && !error ? (
        <p className="small muted" style={{ marginTop: 0 }}>{listHint}</p>
      ) : null}

      {message ? <Alert tone="success">{message}</Alert> : null}
      {actionError ? <ErrorState error={actionError} /> : null}
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && rows.length === 0 ? <EmptyState title="No reviews match" /> : null}

      {rows.length ? (
        <div className="stack">
          {rows.map((review) => (
            <div key={review.id} className="card stack admin-section-card">
              <div className="spread">
                <strong>Review #{review.id}</strong>
                <span className="small muted">{formatInZone(review.created_at)}</span>
              </div>
              <div className="small">
                Rating: {review.rating ?? '—'}
                {review.booking_id ? (
                  <>
                    {' · '}
                    <Link to={`/admin/bookings/${review.booking_id}`}>Booking #{review.booking_id}</Link>
                  </>
                ) : null}
              </div>
              <div className="small muted">
                Coach{' '}
                {review.coach_id ? (
                  <Link to={`/admin/users/${review.coach_id}`}>{review.coach?.full_name || `#${review.coach_id}`}</Link>
                ) : '—'}
                {' · '}
                Student{' '}
                {review.student_id ? (
                  <Link to={`/admin/users/${review.student_id}`}>{review.student?.full_name || `#${review.student_id}`}</Link>
                ) : '—'}
              </div>
              {review.comment ? <p style={{ margin: 0 }}>{review.comment}</p> : null}
              <button
                type="button"
                className="btn danger"
                disabled={busyId === review.id}
                onClick={() => removeReview(review.id)}
              >
                Delete review
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
