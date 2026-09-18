import { Link } from 'react-router-dom';

/**
 * Compact actionable reminder list for student/coach dashboards.
 * @param {{ items: Array<{ id: string, tone?: string, title: string, body: string, to: string, cta: string }> }} props
 */
export function DashboardReminders({ items }) {
  if (!items?.length) return null;

  return (
    <section className="dashboard-reminders" aria-label="Things to do">
      {items.map((item) => (
        <div
          key={item.id}
          className={`alert ${item.tone === 'info' ? 'info' : 'warning'} dashboard-reminder`}
          role="status"
        >
          <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{item.title}</strong>
              <div className="small" style={{ marginTop: 4 }}>{item.body}</div>
            </div>
            <Link className="btn secondary" to={item.to} style={{ flexShrink: 0 }}>
              {item.cta}
            </Link>
          </div>
        </div>
      ))}
    </section>
  );
}
