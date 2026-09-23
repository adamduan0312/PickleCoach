import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import { adminAccountStatusView, formatAdminRoles } from '../../domain/adminStatus.js';
import { adminUsersListHint } from '../../domain/adminUserList.js';
import { formatDateInZone } from '../../utils/datetime.js';

const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'student', label: 'Students' },
  { value: 'coach', label: 'Coaches' },
  { value: 'admin', label: 'Admins' },
];

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
];

const PAGE_SIZE = 50;

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const search = params.get('q') || '';
  const page = Math.max(1, Number(params.get('page') || 1) || 1);
  const [qDraft, setQDraft] = useState(search);

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: PAGE_SIZE, page };
    if (role) query.role = role;
    if (search) query.search = search;
    if (status === 'active') query.is_active = 'true';
    if (status === 'suspended') query.is_active = 'false';
    if (status === 'deleted') query.deleted = 'true';
    const res = await adminApi.users(query);
    return {
      rows: asList(res.data),
      pagination: res.pagination || null,
    };
  }, [role, search, status, page]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const pagination = data?.pagination || null;
  const totalPages = Math.max(1, Number(pagination?.totalPages) || 1);
  const totalItems = pagination?.totalItems;

  const listHint = useMemo(
    () => adminUsersListHint({ statusFilter: status, roleFilter: role, totalItems }),
    [status, role, totalItems],
  );

  function patchParams(patch, { resetPage = true } = {}) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (resetPage && patch.page === undefined) next.delete('page');
    setParams(next);
  }

  function submitSearch(e) {
    e.preventDefault();
    patchParams({ q: qDraft.trim() });
  }

  function goPage(nextPage) {
    const p = Math.min(totalPages, Math.max(1, nextPage));
    patchParams({ page: p > 1 ? String(p) : '' }, { resetPage: false });
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Users"
        subtitle="Account state first (Active / Suspended / Deleted). Role is a separate filter. Reliability and Stripe readiness live on the user detail page."
        actions={<Link className="btn" to="/admin/users/new-admin">Create admin</Link>}
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
        <button className="btn secondary" type="submit">Search</button>
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
        options={STATUS_FILTERS}
        value={status}
        onChange={(next) => patchParams({ status: next })}
      />
      <AdminFilterRow
        options={ROLE_FILTERS}
        value={role}
        onChange={(next) => patchParams({ role: next })}
      />

      {listHint && !loading && !error ? (
        <p className="small muted" style={{ marginTop: 0 }}>{listHint}</p>
      ) : null}

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

      {!loading && !error && pagination ? (
        <div className="spread" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
          <p className="small muted" style={{ margin: 0 }}>
            Page {pagination.currentPage || page} of {totalPages}
            {totalItems != null ? ` · ${totalItems} users` : ''}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn secondary"
              disabled={page <= 1}
              onClick={() => goPage(page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={page >= totalPages}
              onClick={() => goPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
