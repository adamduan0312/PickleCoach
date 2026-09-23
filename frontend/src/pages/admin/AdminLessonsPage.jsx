import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { AdminFilterRow } from '../../components/admin/AdminFilterRow.jsx';
import {
  adminLessonsListHint,
  sortAdminLessonsForList,
} from '../../domain/adminLessonList.js';
import { formatMoney } from '../../utils/format.js';

const ACTIVE_FILTERS = [
  { value: '', label: 'All active states' },
  { value: 'true', label: 'Active lessons' },
  { value: 'false', label: 'Inactive lessons' },
];

/**
 * Read-only admin lesson inventory (GET /admin/lessons).
 */
export function AdminLessonsPage() {
  const [params, setParams] = useSearchParams();
  const isActive = params.get('is_active') || '';
  const includeDeleted = params.get('include_deleted') === 'true';

  const { data, error, loading } = useAsync(async () => {
    const query = { limit: 100 };
    if (isActive) query.is_active = isActive;
    if (includeDeleted) query.include_deleted = 'true';
    return asList((await adminApi.lessons(query)).data);
  }, [isActive, includeDeleted]);

  const rows = useMemo(() => sortAdminLessonsForList(data || []), [data]);

  const listHint = useMemo(
    () => adminLessonsListHint(rows, { isActive, includeDeleted }),
    [rows, isActive, includeDeleted],
  );

  function setActive(next) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('is_active', next);
    else nextParams.delete('is_active');
    setParams(nextParams);
  }

  function toggleDeleted() {
    const nextParams = new URLSearchParams(params);
    if (includeDeleted) nextParams.delete('include_deleted');
    else nextParams.set('include_deleted', 'true');
    setParams(nextParams);
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Lessons"
        subtitle="Lesson inventory — active offerings first, then inactive. Soft-deleted rows appear when “Include deleted” is on."
      />

      <AdminFilterRow options={ACTIVE_FILTERS} value={isActive} onChange={setActive} />
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className={`btn ${includeDeleted ? '' : 'secondary'}`} onClick={toggleDeleted}>
          {includeDeleted ? 'Including deleted' : 'Include deleted'}
        </button>
      </div>

      {listHint && !loading && !error ? (
        <p className="small muted" style={{ marginTop: 0 }}>{listHint}</p>
      ) : null}

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && rows.length === 0 ? <EmptyState title="No lessons match" /> : null}

      {rows.length ? (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Coach</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lesson) => (
                <tr key={lesson.id}>
                  <td>
                    <div>#{lesson.id} {lesson.title || 'Untitled'}</div>
                    <div className="small muted">{lesson.duration_minutes || '—'} min</div>
                  </td>
                  <td>
                    {lesson.coach_id ? (
                      <Link to={`/admin/users/${lesson.coach_id}`}>
                        {lesson.coach?.full_name || `User #${lesson.coach_id}`}
                      </Link>
                    ) : '—'}
                  </td>
                  <td>{formatMoney(lesson.price)}</td>
                  <td>
                    {lesson.deleted_at ? (
                      <StatusBadge status="Deleted" label="Deleted" tone="danger" />
                    ) : (
                      <StatusBadge
                        status={lesson.is_active ? 'Active' : 'Inactive'}
                        label={lesson.is_active ? 'Active' : 'Inactive'}
                        tone={lesson.is_active ? 'success' : 'neutral'}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
