import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { adminAccountStatusView, formatAdminRoles } from '../../domain/adminStatus.js';
import { formatDateInZone } from '../../utils/datetime.js';

const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'student', label: 'Students' },
  { value: 'coach', label: 'Coaches' },
  { value: 'admin', label: 'Admins' },
];

const STATUS_FILTERS = [
  { value: '', label: 'All status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const search = params.get('q') || '';
  const [qDraft, setQDraft] = useState(search);

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: 100 };
    if (role) query.role = role;
    if (search) query.search = search;
    return asList((await adminApi.users(query)).data);
  }, [role, search]);

  const rows = useMemo(() => {
    const list = data || [];
    if (status === 'active') {
      return list.filter((u) => u.is_active !== false && !u.deleted_at);
    }
    if (status === 'suspended') {
      return list.filter((u) => u.is_active === false && !u.deleted_at);
    }
    return list;
  }, [data, status]);

  function patchParams(patch) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next);
  }

  function submitSearch(e) {
    e.preventDefault();
    patchParams({ q: qDraft.trim() });
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Users"
        subtitle="Search and filter marketplace accounts. Reliability and Stripe readiness live on the user detail page."
      />

      <form className="row admin-filter-row" onSubmit={submitSearch}>
        <div className="field" style={{ minWidth: '16rem', flex: '1 1 16rem', margin: 0 }}>
          <label className="visually-hidden" htmlFor="admin-user-search">Search users</label>
          <input
            id="admin-user-search"
            type="search"
            name="q"
            placeholder="Search name or email"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
        </div>
        <button className="btn" type="submit">Search</button>
        {search ? (
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setQDraft('');
              patchParams({ q: '' });
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      <AdminFilterRow
        options={ROLE_FILTERS}
        value={role}
        onChange={(next) => patchParams({ role: next })}
      />
      <AdminFilterRow
        options={STATUS_FILTERS}
        value={status}
        onChange={(next) => patchParams({ status: next })}
      />

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="No users match" detail="Try a different search or filter." />
      ) : null}

      {rows.length ? (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const account = adminAccountStatusView(u);
                return (
                  <tr key={u.id}>
                    <td>
                      <div>{u.full_name}</div>
                      <div className="small muted">{u.email}</div>
                    </td>
                    <td>{formatAdminRoles(u.roles)}</td>
                    <td>
                      <StatusBadge status={account.value} label={account.value} tone={account.tone} />
                    </td>
                    <td className="small muted">{formatDateInZone(u.created_at)}</td>
                    <td>
                      <Link to={`/admin/users/${u.id}`}>View</Link>
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
