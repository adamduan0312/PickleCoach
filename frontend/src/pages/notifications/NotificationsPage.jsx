import { useNavigate } from 'react-router-dom';
import { notificationsApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { relativeFromNow } from '../../utils/datetime.js';

export function NotificationsPage() {
  const navigate = useNavigate();
  const { data, error, loading, setData } = useAsync(async () => {
    const res = await notificationsApi.list();
    const list = asList(res.data);
    // Email/SMS rows share the same headline payload for delivery; only in-app belongs in the feed
    // (matches GET /notifications/unread-count, which counts channel=in_app only).
    return list.filter((n) => n.channel === 'in_app');
  }, []);

  async function open(n) {
    try {
      if (!n.read_at) await notificationsApi.markRead(n.id);
      setData((list) => (list || []).map((row) => (row.id === n.id ? { ...row, read_at: row.read_at || new Date().toISOString() } : row)));
    } catch {
      /* still navigate */
    }
    const route = n.payload?.route;
    if (route) navigate(route);
  }

  return (
    <div className="page">
      <h1>Notifications</h1>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? (
        <EmptyState
          title="No notifications yet"
          detail="Updates about bookings, payments, and messages will show up here."
        />
      ) : null}
      <div className="stack notification-list">
        {(data || []).map((n) => {
          const payload = n.payload || {};
          const isRead = Boolean(n.read_at);
          return (
            <button
              type="button"
              key={n.id}
              className={`card clickable notification-item${isRead ? ' is-read' : ' is-unread'}`}
              onClick={() => open(n)}
            >
              <div className="spread notification-item-top">
                <div className="notification-item-title-row">
                  {!isRead ? <span className="notification-unread-dot" aria-hidden="true" /> : null}
                  <strong>{payload.headline || n.type}</strong>
                  <span className={`badge ${isRead ? 'neutral' : 'info'}`}>
                    {isRead ? 'Read' : 'New'}
                  </span>
                </div>
                <span className="small muted">{relativeFromNow(n.created_at)}</span>
              </div>
              {payload.summary || payload.preview ? (
                <div className="notification-item-body">{payload.summary || payload.preview}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
