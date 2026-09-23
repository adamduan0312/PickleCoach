import { coachesApi, studentsApi } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState } from '../ui/States.jsx';
import {
  formatSelfReliabilityPercent,
  reliabilityActivityRows,
  reliabilityAffectsCopy,
  reliabilityBasedOnSummary,
  reliabilityImproveCopy,
  reliabilityVisibilityCopy,
} from '../../domain/reliabilitySelfServe.js';

/**
 * Settings → Reliability self-serve panel (student or coach mode).
 * @param {{ role: 'student'|'coach' }} props
 */
export function ReliabilitySelfServeCard({ role }) {
  const { data, error, loading } = useAsync(async () => {
    const res = role === 'coach'
      ? await coachesApi.myReliability()
      : await studentsApi.myReliability();
    return res?.data?.reliability ?? res?.reliability ?? null;
  }, [role]);

  const percent = formatSelfReliabilityPercent(data?.reliability_score);
  const activity = reliabilityActivityRows(data, role);

  return (
    <div className="card stack" id="reliability">
      <h2>Reliability</h2>

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}

      {!loading && !error && !data ? (
        <EmptyState title="Reliability unavailable" detail="Try again in a moment." />
      ) : null}

      {!loading && !error && data ? (
        <>
          <div>
            <p className="small muted" style={{ margin: 0 }}>Your reliability</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '1.75rem', fontWeight: 700 }}>
              {percent || '—'}
            </p>
            <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
              {reliabilityBasedOnSummary(role)}
            </p>
          </div>

          <div>
            <h3 className="booking-detail-section-title" style={{ marginTop: 0 }}>How it works</h3>
            <p className="small" style={{ margin: 0 }}>{reliabilityAffectsCopy(role)}</p>
          </div>

          <div>
            <h3 className="booking-detail-section-title" style={{ marginTop: 0 }}>How to improve</h3>
            <p className="small" style={{ margin: 0 }}>{reliabilityImproveCopy()}</p>
          </div>

          {activity.length ? (
            <div>
              <h3 className="booking-detail-section-title" style={{ marginTop: 0 }}>Recent activity</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {activity.map((row) => (
                  <li key={row.key} style={{ marginBottom: row.detail ? '0.5rem' : undefined }}>
                    {row.label}: <strong>{row.count}</strong>
                    {row.detail ? (
                      <div className="muted" style={{ marginTop: '0.2rem' }}>{row.detail}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="small muted" style={{ margin: 0 }}>
            {reliabilityVisibilityCopy(role)}
          </p>
        </>
      ) : null}
    </div>
  );
}
