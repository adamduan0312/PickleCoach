export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', detail, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {detail ? <p className="muted">{detail}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const message = typeof error === 'string' ? error : error?.message || 'Something went wrong.';
  return (
    <div className="error-box">
      <div className="alert error">{message}</div>
      {onRetry ? (
        <button type="button" className="btn secondary" onClick={onRetry} style={{ marginTop: 12 }}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Alert({ tone = 'info', children }) {
  if (!children) return null;
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function StatusBadge({ status, label, tone }) {
  return <span className={`badge ${tone || 'neutral'}`}>{label || status}</span>;
}
