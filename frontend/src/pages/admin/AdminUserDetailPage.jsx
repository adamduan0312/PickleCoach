import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, disputesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminStatusStack } from '../../components/admin/AdminStatusStack.jsx';
import {
  adminAccountStatusView,
  adminBookingStatusView,
  adminDisputeStatusView,
  adminIssueStatusView,
  formatAdminRoles,
  formatReliabilityPercent,
} from '../../domain/adminStatus.js';
import { formatDateInZone, formatInZone } from '../../utils/datetime.js';

const ROLE_OPTIONS = ['student', 'coach', 'admin'];

function coachMarketplaceLines(user) {
  const roles = user.roles || [];
  if (!roles.includes('coach')) {
    return [{ label: 'Coach profile', value: 'Not a coach' }];
  }
  const profile = user.coachProfile;
  if (!profile || profile.deleted_at) {
    return [
      { label: 'Coach profile', value: 'Missing' },
      { label: 'Stripe readiness', value: 'Not ready' },
    ];
  }
  return [
    { label: 'Coach profile', value: profile.headline ? 'Active' : 'Created' },
    { label: 'Stripe readiness', value: profile.stripe_ready ? 'Ready' : 'Not ready' },
    {
      label: 'Connect account',
      value: profile.stripe_account_id ? 'Linked' : 'None',
    },
  ];
}

export function AdminUserDetailPage() {
  const { id } = useParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const { data, error, loading, setData } = useAsync(async () => {
    const user = (await adminApi.user(id)).data;
    const userId = Number(id);
    const [asStudent, asCoach, disputes] = await Promise.all([
      adminApi.bookings({ student_id: userId, limit: 5 }).then((r) => asList(r.data)).catch(() => []),
      adminApi.bookings({ coach_id: userId, limit: 5 }).then((r) => asList(r.data)).catch(() => []),
      disputesApi.list({ limit: 50 }).then((r) => asList(r.data)).catch(() => []),
    ]);

    const relatedDisputes = disputes
      .filter((d) => {
        const b = d.booking;
        if (!b) return false;
        return Number(b.coach_id) === userId || Number(b.primary_student_id) === userId;
      })
      .slice(0, 8);

    const bookingMap = new Map();
    [...asStudent, ...asCoach].forEach((b) => bookingMap.set(b.id, b));
    const recentBookings = [...bookingMap.values()]
      .sort((a, b) => String(b.scheduled_at || '').localeCompare(String(a.scheduled_at || '')))
      .slice(0, 8);

    return { user, recentBookings, relatedDisputes };
  }, [id, reloadTick]);

  async function runAction(label, body) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const res = await adminApi.updateUser(id, body);
      setData((prev) => (prev ? { ...prev, user: res.data } : prev));
      setMessage(label);
      setReloadTick((n) => n + 1);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

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
  if (!data?.user) {
    return (
      <div className="page">
        <EmptyState title="User not found" />
      </div>
    );
  }

  const user = data.user;
  const account = adminAccountStatusView(user);
  const roles = Array.isArray(user.roles) ? [...user.roles] : [];
  const studentScore = formatReliabilityPercent(user.reliability_student);
  const coachScore = formatReliabilityPercent(user.reliability);
  const marketplace = coachMarketplaceLines(user);
  const suspended = user.is_active === false;

  function toggleRole(role) {
    const next = roles.includes(role)
      ? roles.filter((r) => r !== role)
      : [...roles, role];
    if (next.length === 0) {
      window.alert('A user must keep at least one role.');
      return;
    }
    const verb = roles.includes(role) ? 'Remove' : 'Add';
    const ok = window.confirm(`${verb} “${role}” for ${user.full_name || 'this user'}?`);
    if (!ok) return;
    runAction('Roles updated.', { roles: next });
  }

  function toggleSuspend() {
    if (suspended) {
      const ok = window.confirm(`Reactivate ${user.full_name || 'this user'}?`);
      if (!ok) return;
      runAction('User reactivated.', { is_active: true });
      return;
    }
    const ok = window.confirm(
      `Suspend ${user.full_name || 'this user'}?\n\nThey will not be able to use the marketplace until reactivated.`,
    );
    if (!ok) return;
    runAction('User suspended.', { is_active: false });
  }

  return (
    <div className="page">
      <AdminPageHeader
        title={user.full_name || 'User'}
        subtitle="Operational account view — not a full public profile."
        actions={<Link className="btn secondary" to="/admin/users">Back to users</Link>}
      />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {actionError ? <ErrorState error={actionError} /> : null}

      <section className="card stack admin-section-card">
        <div className="spread">
          <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Identity</h2>
          <StatusBadge status={account.value} label={account.value} tone={account.tone} />
        </div>
        <dl className="booking-detail-facts">
          <div>
            <dt>Name</dt>
            <dd>{user.full_name || '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email || '—'}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{formatAdminRoles(roles)}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{formatDateInZone(user.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Reliability</h2>
        <dl className="booking-detail-facts">
          <div>
            <dt>Student</dt>
            <dd>{studentScore || (roles.includes('student') ? '—' : 'N/A')}</dd>
          </div>
          <div>
            <dt>Coach</dt>
            <dd>{coachScore || (roles.includes('coach') ? '—' : 'N/A')}</dd>
          </div>
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Marketplace</h2>
        <dl className="booking-detail-facts">
          {marketplace.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Recent bookings</h2>
        {!data.recentBookings.length ? (
          <EmptyState title="No recent bookings" />
        ) : (
          <div className="stack">
            {data.recentBookings.map((b) => (
              <Link
                key={b.id}
                to={`/admin/bookings/${b.id}`}
                className="card clickable"
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <strong>#{b.id} {b.lesson?.title || 'Lesson'}</strong>
                    <div className="small muted">{formatInZone(b.scheduled_at)}</div>
                  </div>
                  <AdminStatusStack items={[adminBookingStatusView(b), adminIssueStatusView(b)]} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card stack admin-section-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Related disputes</h2>
        {!data.relatedDisputes.length ? (
          <EmptyState title="No related disputes in recent queue" />
        ) : (
          <div className="stack">
            {data.relatedDisputes.map((d) => {
              const status = adminDisputeStatusView(d);
              return (
                <Link
                  key={d.id}
                  to={`/admin/disputes/${d.id}`}
                  className="card clickable"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <div className="spread">
                    <div>
                      <strong>Dispute #{d.id}</strong>
                      <div className="small muted">
                        Booking {d.booking_id} · {d.disputeType?.name || d.disputeType?.code || d.dispute_type_id}
                      </div>
                    </div>
                    <StatusBadge status={status.value} label={status.value} tone={status.tone} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="card stack admin-section-card admin-actions-card">
        <h2 className="booking-detail-section-title" style={{ margin: 0 }}>Admin actions</h2>
        <p className="small muted" style={{ margin: 0 }}>
          These changes affect marketplace access. Confirm carefully.
        </p>
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={toggleSuspend}>
            {suspended ? 'Reactivate account' : 'Suspend account'}
          </button>
        </div>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="small muted">Roles</div>
          <div className="row">
            {ROLE_OPTIONS.map((role) => {
              const on = roles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  className={`btn ${on ? '' : 'secondary'}`}
                  disabled={busy}
                  onClick={() => toggleRole(role)}
                >
                  {on ? `Remove ${role}` : `Add ${role}`}
                </button>
              );
            })}
          </div>
          {user.role_state?.locked ? (
            <p className="small muted">Role governance is locked for this account.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
