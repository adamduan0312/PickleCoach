import { StatusBadge } from '../ui/States.jsx';

/** One labeled status dimension — never collapses booking/issue/money into one badge. */
export function AdminLabeledStatus({ label, value, tone = 'neutral' }) {
  return (
    <div className="admin-status-row">
      <span className="admin-status-label">{label}</span>
      <StatusBadge status={value} label={value} tone={tone} />
    </div>
  );
}

/**
 * @param {{ items: Array<{ key?: string, label: string, value: string, tone?: string }> }} props
 */
export function AdminStatusStack({ items }) {
  if (!items?.length) return null;
  return (
    <div className="admin-status-stack" role="list">
      {items.map((item) => (
        <div key={item.key || item.label} className="admin-status-row" role="listitem">
          <span className="admin-status-label">{item.label}</span>
          <StatusBadge status={item.value} label={item.value} tone={item.tone || 'neutral'} />
        </div>
      ))}
    </div>
  );
}
