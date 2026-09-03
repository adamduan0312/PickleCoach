import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import { adminBookingStatusView, adminIssueStatusView } from '../../domain/adminStatus.js';
import { bookingStatusLabel } from '../../domain/bookingStatus.js';
import { formatInZone } from '../../utils/datetime.js';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'awaiting_verification', label: 'Awaiting verification' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'disputed', label: 'Disputed' },
];

export function AdminBookingsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: 100 };
    if (status) query.status = status;
    return asList((await adminApi.bookings(query)).data);
  }, [status]);

  const rows = useMemo(() => data || [], [data]);

  function setStatus(next) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('status', next);
    else nextParams.delete('status');
    setParams(nextParams);
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Bookings"
        subtitle="Booking status and in-app issues are separate. Payment, escrow, and payout details are on each booking and on Payments."
      />

      <AdminFilterRow options={STATUS_FILTERS} value={status} onChange={setStatus} />

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title={status ? `No ${bookingStatusLabel(status).toLowerCase()} bookings` : 'No bookings'}
        />
      ) : null}

      {rows.length ? (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Student</th>
                <th>Coach</th>
                <th>Lesson</th>
                <th>When</th>
                <th>States</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/admin/bookings/${b.id}`}>#{b.id}</Link>
                  </td>
                  <td>{b.primaryStudent?.full_name || '—'}</td>
                  <td>{b.coach?.full_name || '—'}</td>
                  <td>{b.lesson?.title || 'Lesson'}</td>
                  <td className="small muted">{formatInZone(b.scheduled_at)}</td>
                  <td>
                    <AdminStatusStack items={[adminBookingStatusView(b), adminIssueStatusView(b)]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
