import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, disputesApi } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import { AdminDisputeResolveForm } from '../../components/admin/AdminDisputeResolveForm.jsx';
import {
  adminBookingMoneyStatusItems,
  adminDisputeStatusView,
  adminRefundStatusView,
  disputeAgeLabel,
} from '../../domain/adminStatus.js';
import {
  isDisputeResolvable,
  labelForOption,
  RESOLVE_DECISIONS,
  RESOLVE_OUTCOMES,
  RESOLVE_PENALIZE_ROLES,
} from '../../domain/adminDisputeResolve.js';
import { formatInZone } from '../../utils/datetime.js';
import { courtLabel, formatMoney } from '../../utils/format.js';

function disputeTypeLabel(d) {
  return d?.disputeType?.name || d?.disputeType?.code || d?.dispute_type?.name || d?.dispute_type?.code || d?.dispute_type_id || '—';
}

export function AdminDisputeDetailPage() {
  const { id } = useParams();
  const [reloadTick, setReloadTick] = useState(0);
  const [resolveMessage, setResolveMessage] = useState(null);
  const [resolveWarnings, setResolveWarnings] = useState(null);

  const { data, error, loading } = useAsync(async () => {
    const dispute = (await disputesApi.getById(id)).data;
    let booking = null;
    if (dispute?.booking_id) {
      try {
        booking = (await adminApi.booking(dispute.booking_id)).data;
      } catch {
        booking = dispute.booking || null;
      }
    }
    return { dispute, booking };
  }, [id, reloadTick]);

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
      </div>
    );
  }
  if (!data?.dispute) {
    return (
      <div className="page">
        <EmptyState title="Dispute not found" />
      </div>
    );
  }

  const { dispute, booking } = data;
  const payment = booking?.payments?.[0] || dispute.payment || null;
  const disputeStatus = adminDisputeStatusView(dispute);
  const moneyItems = booking
    ? [...adminBookingMoneyStatusItems({ booking, payment }), adminRefundStatusView(payment)]
    : payment
      ? [
          ...adminBookingMoneyStatusItems({ booking: dispute.booking || {}, payment }),
          adminRefundStatusView(payment),
        ]
      : [];
  const resolvable = isDisputeResolvable(dispute);
  const escrowHeld = payment?.escrow_status === 'held' || payment?.escrow_status === 'pending_release';
  const conversationId = booking?.conversation?.id;

  return (
    <div className="page">
      <AdminPageHeader
        title={`Dispute #${dispute.id} — ${disputeTypeLabel(dispute)}`}
        subtitle="Operations case file — investigate, then resolve when ready."
        actions={<Link className="btn secondary" to="/admin/disputes">Back to disputes</Link>}
      />

      {resolveMessage ? <Alert tone="success">{resolveMessage}</Alert> : null}
      {resolveWarnings?.length ? (
        <Alert tone="warning">
          Advisory warnings:{' '}
          {resolveWarnings.map((w) => w.message || w.code).filter(Boolean).join(' · ')}
        </Alert>
      ) : null}

      <div className="spread" style={{ marginBottom: 12 }}>
        <StatusBadge status={disputeStatus.value} label={disputeStatus.value} tone={disputeStatus.tone} />
        <div className="small muted">Age {disputeAgeLabel(dispute.opened_at)}</div>
      </div>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Parties</h2>
        <dl className="booking-detail-facts">
          <div>
            <dt>Student</dt>
            <dd>
              {booking?.primaryStudent?.full_name ? (
                <Link to={`/admin/users/${booking.primary_student_id}`}>{booking.primaryStudent.full_name}</Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt>Coach</dt>
            <dd>
              {booking?.coach?.full_name ? (
                <Link to={`/admin/users/${booking.coach_id}`}>{booking.coach.full_name}</Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt>Booking</dt>
            <dd>
              {dispute.booking_id ? (
                <Link to={`/admin/bookings/${dispute.booking_id}`}>#{dispute.booking_id}</Link>
              ) : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Issue</h2>
        <dl className="booking-detail-facts">
          <div>
            <dt>Type</dt>
            <dd>{disputeTypeLabel(dispute)}</dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>{dispute.opened_by || '—'}</dd>
          </div>
          <div>
            <dt>Reported at</dt>
            <dd>{formatInZone(dispute.opened_at)}</dd>
          </div>
          <div className="booking-detail-facts-full">
            <dt>Description</dt>
            <dd>{dispute.notes || 'No notes provided.'}</dd>
          </div>
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Booking</h2>
        {booking ? (
          <dl className="booking-detail-facts">
            <div>
              <dt>Lesson</dt>
              <dd>{booking.lesson?.title || 'Lesson'}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{formatInZone(booking.scheduled_at)}</dd>
            </div>
            <div>
              <dt>Where</dt>
              <dd>{courtLabel(booking.courtLocation)}</dd>
            </div>
            <div className="booking-detail-facts-full">
              <dt>States</dt>
              <dd>
                <AdminStatusStack
                  items={adminBookingMoneyStatusItems({ booking, payment }).slice(0, 2)}
                />
              </dd>
            </div>
          </dl>
        ) : (
          <EmptyState title="Booking details unavailable" />
        )}
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Financial state</h2>
        {moneyItems.length ? (
          <>
            <AdminStatusStack items={moneyItems} />
            <div className="admin-money-block">
              <div>
                <h3>Student payment</h3>
                <div>{formatMoney(payment?.total_charge_to_student ?? booking?.price)}</div>
                {payment?.charge_id ? <div className="small muted">Charge {payment.charge_id}</div> : null}
              </div>
              <div>
                <h3>Platform / escrow</h3>
                <div className="small">
                  Expected coach payout {formatMoney(payment?.coach_payout_expected)}
                  {payment?.platform_fee_amount != null ? ` · Fee ${formatMoney(payment.platform_fee_amount)}` : ''}
                </div>
              </div>
              <div>
                <h3>Coach payout</h3>
                <div className="small muted">
                  {moneyItems.find((i) => i.key === 'payout')?.value || '—'}
                  {payment?.transfer_id ? ` · ${payment.transfer_id}` : ''}
                </div>
              </div>
              <div>
                <h3>Refund</h3>
                <div className="small muted">{adminRefundStatusView(payment).value}</div>
              </div>
            </div>
            <Alert tone={escrowHeld ? 'warning' : 'info'}>
              {escrowHeld
                ? 'Funds appear protected in escrow (held / pending release) while this case is open.'
                : resolvable
                  ? 'Review escrow and payout badges carefully before resolving.'
                  : 'Case is closed — confirm money outcomes match the resolution fields below.'}
            </Alert>
          </>
        ) : (
          <EmptyState title="No payment row attached" detail="Open the booking for full money detail if available." />
        )}
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Conversation / evidence</h2>
        {dispute.notes ? (
          <div>
            <strong>Report notes</strong>
            <p style={{ marginTop: 6 }}>{dispute.notes}</p>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No written notes on the dispute row.</p>
        )}
        {conversationId ? (
          <p className="small" style={{ margin: 0 }}>
            Booking conversation:{' '}
            <Link to={`/messages/${conversationId}`}>Open thread #{conversationId}</Link>
          </p>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            No conversation id on this booking yet.
          </p>
        )}
      </section>

      <section className="card stack admin-section-card admin-actions-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>
          {resolvable ? 'Resolve dispute' : 'Resolution'}
        </h2>
        {resolvable ? (
          <AdminDisputeResolveForm
            dispute={dispute}
            onResolved={({ warnings }) => {
              setResolveMessage('Dispute resolved. Booking and payment state refreshed from the server.');
              setResolveWarnings(warnings || null);
              setReloadTick((n) => n + 1);
            }}
          />
        ) : (
          <dl className="booking-detail-facts">
            <div>
              <dt>Decision</dt>
              <dd>{labelForOption(RESOLVE_DECISIONS, dispute.decision)}</dd>
            </div>
            {dispute.outcome ? (
              <div>
                <dt>Attendance outcome</dt>
                <dd>{labelForOption(RESOLVE_OUTCOMES, dispute.outcome)}</dd>
              </div>
            ) : null}
            {dispute.penalize_role ? (
              <div>
                <dt>Penalize</dt>
                <dd>{labelForOption(RESOLVE_PENALIZE_ROLES, dispute.penalize_role)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Financial</dt>
              <dd>
                {dispute.resolutionAction?.name
                  || dispute.resolutionAction?.code
                  || (dispute.refund_amount != null ? 'Partial refund recorded' : '—')}
              </dd>
            </div>
            <div>
              <dt>Resolved at</dt>
              <dd>{dispute.resolved_at ? formatInZone(dispute.resolved_at) : '—'}</dd>
            </div>
            <div>
              <dt>Resolved by</dt>
              <dd>{dispute.resolved_by_admin?.full_name || '—'}</dd>
            </div>
            <div>
              <dt>Refund amount</dt>
              <dd>{dispute.refund_amount != null ? formatMoney(dispute.refund_amount) : '—'}</dd>
            </div>
            <div className="booking-detail-facts-full">
              <dt>Resolution notes</dt>
              <dd>{dispute.resolution_notes || '—'}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
