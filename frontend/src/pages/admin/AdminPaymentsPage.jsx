import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { paymentsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import {
  adminEscrowStatusView,
  adminPaymentStatusView,
  adminPayoutViewForPaymentRow,
  adminRefundStatusView,
} from '../../domain/adminStatus.js';
import { formatMoney } from '../../utils/format.js';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'escrow_held', label: 'Escrow held' },
  { value: 'pending_release', label: 'Pending release' },
  { value: 'payment_failed', label: 'Payment failed' },
  { value: 'refund_issues', label: 'Refund activity' },
];

function filterQuery(filter) {
  if (filter === 'escrow_held') return { escrow_status: 'held' };
  if (filter === 'pending_release') return { escrow_status: 'pending_release' };
  if (filter === 'payment_failed') return { status: 'failed' };
  return {};
}

function matchesClientFilter(payment, filter) {
  if (filter !== 'refund_issues') return true;
  const refund = String(payment.refund_status || 'none').toLowerCase();
  if (refund !== 'none') return true;
  if (Number(payment.refunded_amount) > 0) return true;
  const pay = String(payment.payment_status || '');
  return pay === 'refunded' || pay === 'partially_refunded';
}

export function AdminPaymentsPage() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') || '';

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: 100, ...filterQuery(filter) };
    const rows = asList((await paymentsApi.list(query)).data);
    return rows.filter((p) => matchesClientFilter(p, filter));
  }, [filter]);

  const rows = useMemo(() => data || [], [data]);

  function setFilter(next) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('filter', next);
    else nextParams.delete('filter');
    setParams(nextParams);
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Payments"
        subtitle="PickleCoach money view — student payment, escrow, refund, and coach payout are separate concepts."
      />

      <AdminFilterRow options={FILTERS} value={filter} onChange={setFilter} />

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No payments match" />
      ) : null}

      {rows.length ? (
        <div className="stack">
          {rows.map((p) => {
            const payout = adminPayoutViewForPaymentRow(p);
            const statusItems = [
              adminPaymentStatusView(p),
              adminEscrowStatusView(p),
              payout,
              adminRefundStatusView(p),
            ];
            return (
              <article key={p.id} className="card stack">
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <strong>
                      Payment #{p.id}
                      {p.booking_id ? (
                        <>
                          {' · '}
                          <Link to={`/admin/bookings/${p.booking_id}`}>Booking #{p.booking_id}</Link>
                        </>
                      ) : null}
                    </strong>
                    <div className="small muted">
                      {p.student?.full_name || 'Student'} → {p.coach?.full_name || 'Coach'}
                    </div>
                  </div>
                  <AdminStatusStack items={statusItems} />
                </div>

                <div className="admin-money-block">
                  <div>
                    <h3>Student payment</h3>
                    <div>
                      {formatMoney(p.total_charge_to_student, p.currency)}{' '}
                      <span className="small muted">{adminPaymentStatusView(p).value.toLowerCase()}</span>
                    </div>
                    {p.charge_id ? <div className="small muted">Charge {p.charge_id}</div> : null}
                    {p.payment_intent_id ? <div className="small muted">PI {p.payment_intent_id}</div> : null}
                  </div>
                  <div>
                    <h3>Platform / escrow</h3>
                    <div className="small">
                      Expected coach payout {formatMoney(p.coach_payout_expected, p.currency)}
                    </div>
                    <div className="small muted">
                      Platform fee {formatMoney(p.platform_fee_amount, p.currency)}
                      {p.platform_fee_percent != null ? ` (${p.platform_fee_percent}%)` : ''}
                    </div>
                    <div className="small muted">Escrow: {adminEscrowStatusView(p).value}</div>
                  </div>
                  <div>
                    <h3>Coach payout</h3>
                    <div>{payout.value}</div>
                    {p.transfer_id ? <div className="small muted">Transfer {p.transfer_id}</div> : null}
                    {!p.transfer_id ? (
                      <div className="small muted">No transfer id — this is not a student charge.</div>
                    ) : null}
                  </div>
                  <div>
                    <h3>Refund</h3>
                    <div>{adminRefundStatusView(p).value}</div>
                    {Number(p.refunded_amount) > 0 ? (
                      <div className="small muted">{formatMoney(p.refunded_amount, p.currency)}</div>
                    ) : null}
                    {p.stripe_refund_id ? <div className="small muted">{p.stripe_refund_id}</div> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
