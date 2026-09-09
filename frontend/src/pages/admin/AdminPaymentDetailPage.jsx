import { Link, useParams } from 'react-router-dom';
import { paymentsApi } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import {
  adminEscrowStatusView,
  adminPaymentStatusView,
  adminPayoutViewForPaymentRow,
  adminRefundStatusView,
} from '../../domain/adminStatus.js';
import { formatInZone } from '../../utils/datetime.js';
import { formatMoney } from '../../utils/format.js';

export function AdminPaymentDetailPage() {
  const { id } = useParams();

  const { data: payment, error, loading } = useAsync(async () => {
    return (await paymentsApi.getById(id)).data;
  }, [id]);

  if (loading) {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <ErrorState error={error} />
        <Link to="/admin/payments">Back to payments</Link>
      </div>
    );
  }
  if (!payment) {
    return (
      <div className="page">
        <EmptyState title="Payment not found" />
        <Link to="/admin/payments">Back to payments</Link>
      </div>
    );
  }

  const payout = adminPayoutViewForPaymentRow(payment);
  const statusItems = [
    adminPaymentStatusView(payment),
    adminEscrowStatusView(payment),
    payout,
    adminRefundStatusView(payment),
  ];

  return (
    <div className="page">
      <AdminPageHeader
        title={`Payment #${payment.id}`}
        subtitle="Student payment, escrow, refund, and coach payout for this charge."
        actions={<Link className="btn secondary" to="/admin/payments">Back to payments</Link>}
      />

      <div className="spread" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        <AdminStatusStack items={statusItems} />
      </div>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Parties</h2>
        <dl className="booking-detail-facts">
          <div>
            <dt>Student</dt>
            <dd>
              {payment.student?.full_name ? (
                <Link to={`/admin/users/${payment.student_id}`}>{payment.student.full_name}</Link>
              ) : '—'}
              {payment.student?.email ? (
                <div className="small muted">{payment.student.email}</div>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Coach</dt>
            <dd>
              {payment.coach?.full_name ? (
                <Link to={`/admin/users/${payment.coach_id}`}>{payment.coach.full_name}</Link>
              ) : '—'}
              {payment.coach?.email ? (
                <div className="small muted">{payment.coach.email}</div>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Booking</dt>
            <dd>
              {payment.booking_id ? (
                <Link to={`/admin/bookings/${payment.booking_id}`}>#{payment.booking_id}</Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{payment.created_at ? formatInZone(payment.created_at) : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Money state</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Student charge, escrow, refund, and coach payout are separate. A charge must never end up both refunded and paid out.
        </p>
        <div className="admin-money-block">
          <div>
            <h3>Student payment</h3>
            <div>
              {formatMoney(payment.total_charge_to_student, payment.currency)}{' '}
              <span className="small muted">{adminPaymentStatusView(payment).value.toLowerCase()}</span>
            </div>
            {payment.charge_id ? <div className="small muted">Charge {payment.charge_id}</div> : null}
            {payment.payment_intent_id ? <div className="small muted">PI {payment.payment_intent_id}</div> : null}
            {!payment.charge_id && !payment.payment_intent_id ? (
              <div className="small muted">No Stripe charge / PaymentIntent on this row.</div>
            ) : null}
          </div>
          <div>
            <h3>Platform / escrow</h3>
            <div className="small">
              Expected coach payout {formatMoney(payment.coach_payout_expected, payment.currency)}
            </div>
            <div className="small muted">
              Platform fee {formatMoney(payment.platform_fee_amount, payment.currency)}
              {payment.platform_fee_percent != null ? ` (${payment.platform_fee_percent}%)` : ''}
            </div>
            <div className="small muted">Escrow: {adminEscrowStatusView(payment).value}</div>
          </div>
          <div>
            <h3>Coach payout</h3>
            <div>{payout.value}</div>
            {payment.transfer_id ? <div className="small muted">Transfer {payment.transfer_id}</div> : null}
            {payment.payout_id ? <div className="small muted">Payout {payment.payout_id}</div> : null}
            {!payment.transfer_id ? (
              <div className="small muted">No transfer id on this row.</div>
            ) : null}
          </div>
          <div>
            <h3>Refund</h3>
            <div>{adminRefundStatusView(payment).value}</div>
            {Number(payment.refunded_amount) > 0 ? (
              <div className="small muted">{formatMoney(payment.refunded_amount, payment.currency)}</div>
            ) : null}
            {payment.stripe_refund_id ? <div className="small muted">{payment.stripe_refund_id}</div> : null}
          </div>
        </div>
      </section>

      {payment.booking_id ? (
        <p className="small muted">
          Destructive money actions live on the{' '}
          <Link to={`/admin/bookings/${payment.booking_id}`}>booking detail</Link>
          {'. '}
          Prefer the dispute resolve flow when an issue is open.
        </p>
      ) : null}
    </div>
  );
}
