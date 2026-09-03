import { Link } from 'react-router-dom';
import { adminApi, disputesApi, paymentsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import {
  adminBookingStatusView,
  adminDisputeStatusView,
  adminIssueStatusView,
  adminPaymentStatusView,
  adminRefundStatusView,
  disputeAgeLabel,
} from '../../domain/adminStatus.js';
import { formatInZone } from '../../utils/datetime.js';
import { formatMoney } from '../../utils/format.js';

function humanizeAudit(row) {
  const action = String(row.action || 'event').replace(/_/g, ' ');
  const table = row.table_name || 'record';
  const id = row.record_id != null ? ` #${row.record_id}` : '';
  return `${action} · ${table}${id}`;
}

function auditLink(row) {
  if (row.table_name === 'bookings' && row.record_id != null) {
    return `/admin/bookings/${row.record_id}`;
  }
  if (row.table_name === 'disputes' && row.record_id != null) {
    return `/admin/disputes/${row.record_id}`;
  }
  if (row.table_name === 'users' && row.record_id != null) {
    return `/admin/users/${row.record_id}`;
  }
  return null;
}

export function AdminDashboardPage() {
  const { data, error, loading } = useAsync(async () => {
    const [stats, pendingBookings, cancelledBookings, openDisputes, reviewDisputes, payments, audit] =
      await Promise.all([
        adminApi.dashboard().then((r) => r.data),
        adminApi.bookings({ status: 'pending', limit: 8 }).then((r) => asList(r.data)).catch(() => []),
        adminApi.bookings({ status: 'cancelled', limit: 8 }).then((r) => asList(r.data)).catch(() => []),
        disputesApi.list({ status: 'open', limit: 10 }).then((r) => asList(r.data)).catch(() => []),
        disputesApi.list({ status: 'under_review', limit: 10 }).then((r) => asList(r.data)).catch(() => []),
        paymentsApi.list({ limit: 40 }).then((r) => asList(r.data)).catch(() => []),
        adminApi.auditLogs({ limit: 20 }).then((r) => asList(r.data)).catch(() => []),
      ]);

    const disputeMap = new Map();
    [...openDisputes, ...reviewDisputes].forEach((d) => disputeMap.set(d.id, d));
    const disputes = [...disputeMap.values()].sort((a, b) =>
      String(b.opened_at || '').localeCompare(String(a.opened_at || '')),
    );

    const paymentIssues = payments.filter((p) => {
      const pay = String(p.payment_status || '');
      const refund = String(p.refund_status || 'none').toLowerCase();
      if (pay === 'failed') return true;
      if (refund !== 'none' && refund !== 'succeeded' && refund !== 'complete' && refund !== 'completed' && refund !== 'full') {
        return true;
      }
      if (pay === 'refunded' || pay === 'partially_refunded') return true;
      if (Number(p.refunded_amount) > 0 && p.escrow_status === 'held') return true;
      return false;
    }).slice(0, 8);

    return {
      stats,
      pendingBookings,
      cancelledBookings: cancelledBookings.slice(0, 6),
      disputes: disputes.slice(0, 8),
      paymentIssues,
      audit: audit.slice(0, 20),
    };
  }, []);

  return (
    <div className="page">
      <AdminPageHeader
        title="Dashboard"
        subtitle="What needs attention right now — not analytics."
      />

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}

      {data?.stats ? (
        <div className="grid-3">
          <Link className="card" to="/admin/bookings" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="small muted">Active bookings</div>
            <strong>{data.stats.bookings?.active ?? '—'}</strong>
          </Link>
          <Link className="card" to="/admin/disputes" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="small muted">Open disputes</div>
            <strong>{data.stats.disputes?.pending ?? '—'}</strong>
          </Link>
          <Link className="card" to="/admin/users?role=student" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="small muted">Students</div>
            <strong>{data.stats.users?.total_students ?? '—'}</strong>
          </Link>
          <Link className="card" to="/admin/users?role=coach" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="small muted">Coaches</div>
            <strong>{data.stats.users?.total_coaches ?? '—'}</strong>
          </Link>
        </div>
      ) : null}

      {data ? (
        <section className="stack admin-section-card">
          <h2 className="booking-detail-section-title">Needs attention</h2>

          <div className="card stack">
            <div className="spread">
              <strong>Open disputes</strong>
              <Link className="small" to="/admin/disputes">View queue</Link>
            </div>
            {!data.disputes.length ? (
              <EmptyState title="No open disputes" />
            ) : (
              data.disputes.map((d) => {
                const status = adminDisputeStatusView(d);
                return (
                  <Link
                    key={d.id}
                    to={`/admin/disputes/${d.id}`}
                    className="spread"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    <div>
                      <strong>Dispute #{d.id}</strong>
                      <div className="small muted">
                        Booking {d.booking_id} · age {disputeAgeLabel(d.opened_at)}
                      </div>
                    </div>
                    <StatusBadge status={status.value} label={status.value} tone={status.tone} />
                  </Link>
                );
              })
            )}
          </div>

          <div className="card stack">
            <div className="spread">
              <strong>Pending booking requests</strong>
              <Link className="small" to="/admin/bookings?status=pending">View bookings</Link>
            </div>
            {!data.pendingBookings.length ? (
              <EmptyState title="No pending requests" />
            ) : (
              data.pendingBookings.map((b) => (
                <Link
                  key={b.id}
                  to={`/admin/bookings/${b.id}`}
                  className="spread"
                  style={{ color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' }}
                >
                  <div>
                    <strong>#{b.id} {b.lesson?.title || 'Lesson'}</strong>
                    <div className="small muted">
                      {b.primaryStudent?.full_name || 'Student'} → {b.coach?.full_name || 'Coach'}
                    </div>
                  </div>
                  <AdminStatusStack items={[adminBookingStatusView(b), adminIssueStatusView(b)]} />
                </Link>
              ))
            )}
          </div>

          <div className="card stack">
            <div className="spread">
              <strong>Payment / refund problems</strong>
              <Link className="small" to="/admin/payments?filter=refund_issues">View payments</Link>
            </div>
            {!data.paymentIssues.length ? (
              <EmptyState title="No payment issues flagged" />
            ) : (
              data.paymentIssues.map((p) => (
                <Link
                  key={p.id}
                  to={p.booking_id ? `/admin/bookings/${p.booking_id}` : '/admin/payments'}
                  className="spread"
                  style={{ color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' }}
                >
                  <div>
                    <strong>Payment #{p.id}</strong>
                    <div className="small muted">
                      {formatMoney(p.total_charge_to_student, p.currency)}
                      {p.booking_id ? ` · Booking #${p.booking_id}` : ''}
                    </div>
                  </div>
                  <AdminStatusStack items={[adminPaymentStatusView(p), adminRefundStatusView(p)]} />
                </Link>
              ))
            )}
          </div>

          <div className="card stack">
            <div className="spread">
              <strong>Recent cancellations</strong>
              <Link className="small" to="/admin/bookings?status=cancelled">View cancelled</Link>
            </div>
            {!data.cancelledBookings.length ? (
              <EmptyState title="No recent cancellations" />
            ) : (
              data.cancelledBookings.map((b) => (
                <Link
                  key={b.id}
                  to={`/admin/bookings/${b.id}`}
                  className="spread"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <div>
                    <strong>#{b.id}</strong>
                    <div className="small muted">{formatInZone(b.scheduled_at)}</div>
                  </div>
                  <StatusBadge status="Cancelled" label="Cancelled" tone="danger" />
                </Link>
              ))
            )}
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="card stack admin-section-card">
          <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Recent activity</h2>
          {!data.audit.length ? (
            <EmptyState title="No recent audit events" />
          ) : (
            data.audit.map((row) => {
              const href = auditLink(row);
              const body = (
                <>
                  <div>{humanizeAudit(row)}</div>
                  <div className="small muted">{formatInZone(row.created_at)}</div>
                </>
              );
              return href ? (
                <Link key={row.id} to={href} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {body}
                </Link>
              ) : (
                <div key={row.id}>{body}</div>
              );
            })
          )}
        </section>
      ) : null}
    </div>
  );
}

/** @deprecated Use AdminDashboardPage */
export const AdminHomePage = AdminDashboardPage;
