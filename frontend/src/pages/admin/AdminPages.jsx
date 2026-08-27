import { Link, useParams } from 'react-router-dom';
import { adminApi, disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { bookingStatusLabel, bookingStatusTone } from '../../domain/bookingStatus.js';
import { formatInZone } from '../../utils/datetime.js';

export function AdminHomePage() {
  const { data, error, loading } = useAsync(() => adminApi.dashboard().then((r) => r.data), []);
  return (
    <div className="page">
      <h1>Admin</h1>
      <p className="muted">Basic operations shell — users, bookings, disputes. Not a full admin product yet.</p>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {data ? (
        <div className="grid-3">
          <div className="card"><div className="small muted">Students</div><strong>{data.users?.total_students ?? '—'}</strong></div>
          <div className="card"><div className="small muted">Coaches</div><strong>{data.users?.total_coaches ?? '—'}</strong></div>
          <div className="card"><div className="small muted">Bookings</div><strong>{data.bookings?.total ?? '—'}</strong><div className="small muted">{data.bookings?.active ?? 0} active</div></div>
          <div className="card"><div className="small muted">Revenue</div><strong>{data.revenue?.total ?? '—'}</strong><div className="small muted">fees {data.revenue?.commissions ?? '—'}</div></div>
          <div className="card"><div className="small muted">Open disputes</div><strong>{data.disputes?.pending ?? '—'}</strong></div>
        </div>
      ) : null}
      <div className="row" style={{ marginTop: 16 }}>
        <Link className="btn" to="/admin/users">Users</Link>
        <Link className="btn secondary" to="/admin/bookings">Bookings</Link>
        <Link className="btn secondary" to="/admin/disputes">Disputes</Link>
      </div>
    </div>
  );
}

export function AdminUsersPage() {
  const { data, error, loading } = useAsync(async () => asList((await adminApi.users()).data), []);
  return (
    <div className="page">
      <h1>Users</h1>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? <EmptyState title="No users" /> : null}
      <div className="table-wrap card">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Roles</th><th></th></tr>
          </thead>
          <tbody>
            {(data || []).map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{(u.roles || []).join(', ')}</td>
                <td><Link to={`/admin/users/${u.id}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminUserDetailPage() {
  const { id } = useParams();
  const { data, error, loading } = useAsync(() => adminApi.user(id).then((r) => r.data), [id]);
  if (loading) return <div className="page"><LoadingState /></div>;
  if (error) return <div className="page"><ErrorState error={error} /></div>;
  if (!data) return <div className="page"><EmptyState title="User not found" /></div>;
  return (
    <div className="page">
      <h1>{data.full_name}</h1>
      <div className="card stack">
        <div>{data.email}</div>
        <div>Roles: {(data.roles || data.role_state?.effective_roles || []).join(', ')}</div>
        <div>Active: {String(data.is_active)}</div>
        <div>Timezone: {data.timezone}</div>
      </div>
      <p><Link to="/admin/users">Back</Link></p>
    </div>
  );
}

export function AdminBookingsPage() {
  const { data, error, loading } = useAsync(async () => asList((await adminApi.bookings()).data), []);
  return (
    <div className="page">
      <h1>Bookings</h1>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? <EmptyState title="No bookings" /> : null}
      <div className="stack">
        {(data || []).map((b) => (
          <Link key={b.id} to={`/admin/bookings/${b.id}`} className="card clickable" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="spread">
              <div>
                <strong>#{b.id} {b.lesson?.title || 'Lesson'}</strong>
                <div className="small muted">{formatInZone(b.scheduled_at)} · coach {b.coach?.full_name} · student {b.primaryStudent?.full_name}</div>
              </div>
              <StatusBadge status={b.status} label={bookingStatusLabel(b.status)} tone={bookingStatusTone(b.status)} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function AdminDisputesPage() {
  const { data, error, loading } = useAsync(async () => asList((await disputesApi.list()).data), []);
  return (
    <div className="page">
      <h1>Disputes</h1>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? <EmptyState title="No disputes" /> : null}
      <div className="stack">
        {(data || []).map((d) => (
          <Link key={d.id} to={`/admin/disputes/${d.id}`} className="card clickable" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="spread">
              <div>
                <strong>Dispute #{d.id}</strong>
                <div className="small muted">Booking {d.booking_id} · {d.dispute_type?.code || d.dispute_type_id}</div>
              </div>
              <StatusBadge status={d.status} label={d.status} tone={d.status === 'resolved' ? 'neutral' : 'warning'} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function AdminDisputeDetailPage() {
  const { id } = useParams();
  const { data, error, loading } = useAsync(() => disputesApi.getById(id).then((r) => r.data), [id]);
  if (loading) return <div className="page"><LoadingState /></div>;
  if (error) return <div className="page"><ErrorState error={error} /></div>;
  if (!data) return <div className="page"><EmptyState title="Dispute not found" /></div>;
  return (
    <div className="page">
      <h1>Dispute #{data.id}</h1>
      <div className="card stack">
        <div>Status: {data.status}</div>
        <div>Booking: {data.booking_id ? <Link to={`/admin/bookings/${data.booking_id}`}>#{data.booking_id}</Link> : '—'}</div>
        <div>Type: {data.dispute_type?.code || data.dispute_type_id}</div>
        <div>Notes: {data.notes || '—'}</div>
        <p className="small muted">Resolve via API for now if the type-specific payload is required. This shell lists and opens disputes without guessing resolve payloads.</p>
      </div>
    </div>
  );
}
