import { Link } from 'react-router-dom';
import { coachesApi } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { InfoTip } from '../ui/InfoTip.jsx';
import {
  COACH_DASHBOARD_RELIABILITY_NOTE,
  COACH_DASHBOARD_RELIABILITY_NOTE_UNLISTED,
  COACH_OWN_RELIABILITY_HINT,
  formatSelfReliabilityPercent,
} from '../../domain/reliabilitySelfServe.js';

export function CoachReliabilitySummary({ listed }) {
  const { data } = useAsync(async () => {
    const res = await coachesApi.myReliability();
    return res?.data?.reliability ?? res?.reliability ?? null;
  }, []);
  const percent = formatSelfReliabilityPercent(data?.reliability_score);
  if (!percent) return null;
  return (
    <div className="card coach-reliability-summary">
      <p className="coach-reliability-score">
        <span className="muted">Your reliability</span>
        <strong>{percent}</strong>
        <InfoTip label="What your reliability score means">{COACH_OWN_RELIABILITY_HINT}</InfoTip>
      </p>
      <p className="small muted">
        {listed ? COACH_DASHBOARD_RELIABILITY_NOTE : COACH_DASHBOARD_RELIABILITY_NOTE_UNLISTED} <Link to="/settings#reliability">How reliability works</Link>
      </p>
    </div>
  );
}
