import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { adminDisputeStatusView, disputeAgeLabel } from '../../domain/adminStatus.js';
import {
  adminDisputesListHint,
  sortAdminDisputesForList,
} from '../../domain/adminDisputeList.js';
import { formatInZone } from '../../utils/datetime.js';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

function disputeTypeLabel(d) {
  return d?.disputeType?.name || d?.disputeType?.code || d?.dispute_type?.name || d?.dispute_type?.code || d?.dispute_type_id || '—';
}

export function AdminDisputesPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') || 'open';

  const { data, error, loading } = useAsync(async () => {
    if (filter === 'open') {
      const [openRows, reviewRows] = await Promise.all([
        disputesApi.list({ status: 'open', limit: 100 }).then((r) => asList(r.data)),
        disputesApi.list({ status: 'under_review', limit: 100 }).then((r) => asList(r.data)),
      ]);
      const map = new Map();
      [...openRows, ...reviewRows].forEach((d) => map.set(d.id, d));
      return [...map.values()];
    }
    if (filter === 'resolved') {
      return asList((await disputesApi.list({ status: 'resolved', limit: 100 })).data);
    }
    return asList((await disputesApi.list({ limit: 100 })).data);
  }, [filter]);

  const rows = useMemo(
    () => sortAdminDisputesForList(data || [], filter),
    [data, filter],
  );

  const listHint = useMemo(
    () => adminDisputesListHint(rows, filter),
    [rows, filter],
  );

  function setFilter(next) {
    const nextParams = new URLSearchParams(params);
    if (next && next !== 'open') nextParams.set('status', next);
    else nextParams.delete('status');
    setParams(nextParams);
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Disputes"
        subtitle="Dispute lifecycle first — open/under review before closed. Booking status and financial outcomes stay on the case file."
      />

      <AdminFilterRow options={FILTERS} value={filter} onChange={setFilter} />

      {listHint && !loading && !error ? (
        <p className="small muted" style={{ marginTop: 0 }}>{listHint}</p>
      ) : null}

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'No open disputes' : filter === 'resolved' ? 'No resolved disputes' : 'No disputes'}
        />
      ) : null}

      {rows.length ? (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>Dispute</th>
                <th>Booking</th>
                <th>Issue type</th>
                <th>Reported</th>
                <th>Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const status = adminDisputeStatusView(d);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/admin/disputes/${d.id}`}>#{d.id}</Link>
                      <div className="small muted">by {d.opened_by || '—'}</div>
                    </td>
                    <td>
                      {d.booking_id ? (
                        <Link to={`/admin/bookings/${d.booking_id}`}>#{d.booking_id}</Link>
                      ) : '—'}
                    </td>
                    <td>{disputeTypeLabel(d)}</td>
                    <td className="small muted">{formatInZone(d.opened_at)}</td>
                    <td className="small muted">{disputeAgeLabel(d.opened_at)}</td>
                    <td>
                      <StatusBadge status={status.value} label={status.value} tone={status.tone} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
