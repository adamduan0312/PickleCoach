import { Link, useParams } from 'react-router-dom';
import { disputesApi } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/ui/States.jsx';
import { formatInZone } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import {
  adminNotesText,
  issueResolutionFacts,
} from '../../domain/issueResolutionDisplay.js';
import {
  bookingSettlementDisplayRows,
  bookingSettlementFacts,
} from '../../domain/bookingSettlementDisplay.js';

function issueTypeLabel(issue) {
  return issue?.disputeType?.name || issue?.dispute_type?.name || 'Issue';
}

/**
 * Customer-facing issue / issue-resolution page (not admin dispute ops).
 * Uses GET /disputes/:id — participants only see customer-safe fields.
 */
export function IssueDetailPage() {
  const { id } = useParams();
  const { user, mode } = useAuth();
  const tz = user?.timezone;

  const { data: issue, error, loading } = useAsync(async () => {
    const res = await disputesApi.getById(id);
    return res.data;
  }, [id]);

  if (loading) return <div className="page"><LoadingState /></div>;
  if (error) return <div className="page"><ErrorState error={error} /></div>;
  if (!issue) return <div className="page"><EmptyState title="Issue not found" /></div>;

  const resolved = issue.status === 'resolved';
  const facts = issueResolutionFacts(issue);
  const adminNotes = adminNotesText(issue);
  const reporterNotes = typeof issue.notes === 'string' ? issue.notes.trim() : '';
  const bookingId = issue.booking_id;
  const listFallback = mode === 'coach' ? '/coach/bookings' : '/bookings';
  const backTo = bookingId ? `/bookings/${bookingId}` : listFallback;
  const settlement = resolved
    ? bookingSettlementFacts(issue.booking, issue.payment, issue)
    : null;
  const settlementRows = settlement ? bookingSettlementDisplayRows(settlement) : [];

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <div>
          <h1>{resolved ? 'Issue resolution' : 'Issue details'}</h1>
          <p className="muted" style={{ margin: 0 }}>{issueTypeLabel(issue)}</p>
        </div>
        <StatusBadge
          status={resolved ? 'completed' : 'issue'}
          label={resolved ? 'Resolved' : 'Issue reported'}
          tone={resolved ? 'success' : 'warning'}
        />
      </div>

      <section className="card stack">
        <dl className="booking-detail-facts">
          <div>
            <dt>Issue reported</dt>
            <dd>{issue.opened_at ? formatInZone(issue.opened_at, tz) : '—'}</dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>{issue.opened_by === 'coach' ? 'Coach' : issue.opened_by === 'student' ? 'Student' : (issue.opened_by || '—')}</dd>
          </div>
          {reporterNotes ? (
            <div className="booking-detail-facts-full">
              <dt>Reporter notes</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{reporterNotes}</dd>
            </div>
          ) : null}
          <div>
            <dt>Status</dt>
            <dd>{resolved ? 'Resolved' : 'Under review'}</dd>
          </div>
          {resolved && issue.resolved_at ? (
            <div>
              <dt>Resolved</dt>
              <dd>{formatInZone(issue.resolved_at, tz)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {resolved ? (
        <section className="card stack" style={{ marginTop: 16 }}>
          <h2 className="booking-detail-section-title" style={{ marginTop: 0 }}>Resolution</h2>
          <dl className="booking-detail-facts">
            {facts.decision ? (
              <div>
                <dt>Decision</dt>
                <dd>{facts.decision}</dd>
              </div>
            ) : null}
            {facts.financial ? (
              <div>
                <dt>Dispute financial action</dt>
                <dd>{facts.financial}</dd>
              </div>
            ) : null}
            {facts.attendance ? (
              <div>
                <dt>Attendance finding</dt>
                <dd>{facts.attendance}</dd>
              </div>
            ) : null}
            {facts.reliability ? (
              <div>
                <dt>Reliability</dt>
                <dd>{facts.reliability}</dd>
              </div>
            ) : null}
            {adminNotes ? (
              <div className="booking-detail-facts-full">
                <dt>Admin notes</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{adminNotes}</dd>
              </div>
            ) : null}
          </dl>
          {settlementRows.length ? (
            <>
              <h3 className="booking-detail-section-title" style={{ marginTop: 16 }}>
                {settlement.settlementHeadline}
              </h3>
              <dl className="booking-detail-facts">
                {settlementRows.map((row) => (
                  <div key={row.dt}>
                    <dt>{row.dt}</dt>
                    <dd>{row.dd}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </section>
      ) : null}

      <p className="small" style={{ marginTop: 16 }}>
        <Link to={backTo}>Back to booking</Link>
      </p>
    </div>
  );
}
