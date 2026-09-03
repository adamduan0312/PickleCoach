import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { adminDisputeStatusView, disputeAgeLabel } from '../../domain/adminStatus.js';
import { formatInZone } from '../../utils/datetime.js';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

function isOpenDispute(d) {
  return d?.status === 'open' || d?.status === 'under_review';
}

function disputeTypeLabel(d) {
  return d?.disputeType?.name || d?.disputeType?.code || d?.dispute_type?.name || d?.dispute_type?.code || d?.dispute_type_id || '—';
}

export function AdminDisputesPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') || 'open';

  const { data, error, loading } = useAsync(async () => {
    // Fetch open + under_review separately when filter=open; otherwise use API status or all.
    if (filter === 'open') {
      const [openRows, reviewRows] = await Promise.all([
        disputesApi.list({ status: 'open', limit: 100 }).then((r) => asList(r.data)),
        disputesApi.list({ status: 'under_review', limit: 100 }).then((r) => asList(r.data)),
      ]);
      const map = new Map();
      [...openRows, ...reviewRows].forEach((d) => map.set(d.id, d));
      return [...map.values()].sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
    }
    if (filter === 'resolved') {
      return asList((await disputesApi.list({ status: 'resolved', limit: 100 })).data);
    }
    return asList((await disputesApi.list({ limit: 100 })).data);
  }, [filter]);

  const rows = useMemo(() => data || [], [data]);
  const openRows = rows.filter(isOpenDispute);
  const resolvedRows = rows.filter((d) => !isOpenDispute(d));

  function setFilter(next) {
    const nextParams = new URLSearchParams(params);
    if (next && next !== 'open') nextParams.set('status', next);
    else nextParams.delete('status');
    setParams(nextParams);
  }

  function renderTable(list) {
    if (!list.length) return null;
    return (
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
            {list.map((d) => {
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
    );
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Disputes"
        subtitle="Open cases first. Resolve from the case file when ready."
      />

      <AdminFilterRow options={FILTERS} value={filter} onChange={setFilter} />

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'No open disputes' : filter === 'resolved' ? 'No resolved disputes' : 'No disputes'}
        />
      ) : null}

      {filter === 'all' && openRows.length ? (
        <section className="stack admin-section-card">
          <h2 className="booking-detail-section-title">Open</h2>
          {renderTable(openRows)}
        </section>
      ) : null}

      {filter === 'all' && resolvedRows.length ? (
        <section className="stack admin-section-card">
          <h2 className="booking-detail-section-title">Resolved</h2>
          {renderTable(resolvedRows)}
        </section>
      ) : null}

      {filter !== 'all' ? renderTable(rows) : null}
    </div>
  );
}
