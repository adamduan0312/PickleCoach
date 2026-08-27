import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { messagesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States.jsx';
import { formatInZone, detectLocalTimezone } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';

export function ConversationsPage() {
  const { data, error, loading } = useAsync(async () => {
    const res = await messagesApi.conversations();
    return asList(res.data);
  }, []);

  return (
    <div className="page">
      <h1>Messages</h1>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && (!data || data.length === 0) ? (
        <EmptyState title="No conversations" detail="Open a booking and start a conversation from there." />
      ) : null}
      <div className="stack">
        {(data || []).map((c) => (
          <Link key={c.id} to={`/messages/${c.id}`} className="card clickable" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="spread">
              <strong>Booking #{c.booking_id}</strong>
              {c.unread_count > 0 ? <span className="badge warning">{c.unread_count} unread</span> : null}
            </div>
            <div className="small muted">{c.latest_message?.message_text || 'No messages yet'}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ConversationPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const { data, error: loadError, loading, setData } = useAsync(async () => {
    const res = await messagesApi.conversation(id);
    return res.data;
  }, [id]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await messagesApi.conversation(id);
        setData(res.data);
      } catch {
        /* ignore poll errors */
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [id, setData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await messagesApi.send({ conversation_id: Number(id), message_text: text.trim() });
      setText('');
      const res = await messagesApi.conversation(id);
      setData(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><LoadingState /></div>;
  if (loadError) return <div className="page"><ErrorState error={loadError} /></div>;
  if (!data) return <div className="page"><EmptyState title="Conversation not found" /></div>;

  const locked = data.booking?.messaging_locked;
  const messages = data.messages || [];

  return (
    <div className="page">
      <div className="spread">
        <h1>Conversation</h1>
        {data.booking_id ? <Link to={`/bookings/${data.booking_id}`}>View booking</Link> : null}
      </div>
      <Alert tone="error">{error}</Alert>
      {locked ? <Alert tone="warning">Messaging is locked for this booking.</Alert> : null}
      <div className="card chat">
        <div className="chat-list">
          {messages.length === 0 ? <EmptyState title="No messages yet" /> : null}
          {messages.map((m) => (
            <div key={m.id} className={`bubble${m.sender_id === user?.id ? ' mine' : ''}`}>
              <div>{m.message_text}</div>
              <div className="small" style={{ opacity: 0.8 }}>{m.sender?.full_name || ''} · {formatInZone(m.created_at, user?.timezone || detectLocalTimezone(), { weekday: undefined, year: undefined })}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form className="chat-composer" onSubmit={send}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={locked || busy} placeholder={locked ? 'Messaging locked' : 'Write a message'} />
          <button className="btn" type="submit" disabled={locked || busy || !text.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}
