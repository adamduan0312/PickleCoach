import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { messagesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States.jsx';
import { CharacterCounter } from '../../components/ui/CharacterLimit.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatInZone, detectLocalTimezone } from '../../utils/datetime.js';

function conversationCounterpartName(messages, currentUserId) {
  if (!Array.isArray(messages) || currentUserId == null) return null;
  const other = messages.find((m) => m.sender_id !== currentUserId && m.sender?.full_name);
  return other?.sender?.full_name || null;
}

export function ConversationsPage() {
  const { data, error, loading } = useAsync(async () => {
    const res = await messagesApi.conversations();
    return asList(res.data);
  }, []);

  return (
    <div className="page">
      <div className="page-header messages-page-header">
        <div>
          <h1>Messages</h1>
          <p className="muted messages-page-lead">
            Keep lesson conversations, questions, and updates in one place.
          </p>
        </div>
      </div>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState error={error} /> : null}
      {!loading && !error && (!data || data.length === 0) ? (
        <EmptyState
          title="No conversations"
          detail="Open a booking and start a conversation from there."
        />
      ) : null}
      {!loading && !error && data?.length > 0 ? (
        <div className="stack messages-inbox">
          {data.map((c) => {
            const preview = c.latest_message?.message_text?.trim();
            const hasPreview = Boolean(preview);
            return (
              <Link
                key={c.id}
                to={`/messages/${c.id}`}
                className="card clickable messages-inbox-card"
              >
                <div className="spread messages-inbox-card-top">
                  <strong className="messages-inbox-booking">Booking #{c.booking_id}</strong>
                  {c.unread_count > 0 ? (
                    <span className="badge warning">{c.unread_count} unread</span>
                  ) : null}
                </div>
                <p className={`messages-inbox-preview${hasPreview ? '' : ' muted'}`}>
                  {hasPreview ? preview : 'No messages yet'}
                </p>
              </Link>
            );
          })}
        </div>
      ) : null}
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
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await messagesApi.send({ conversation_id: Number(id), message_text: text.trim() });
      setText('');
      const res = await messagesApi.conversation(id);
      setData(res.data);
    } catch (err) {
      setError(err.message || 'Failed to send message.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingState />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="page">
        <ErrorState error={loadError} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <EmptyState title="Conversation not found" />
      </div>
    );
  }

  const locked = Boolean(data.booking?.messaging_locked);
  const messages = data.messages || [];
  const tz = user?.timezone || detectLocalTimezone();
  const counterpart = conversationCounterpartName(messages, user?.id);
  const canSend = !locked && !busy && Boolean(text.trim());

  return (
    <div className="page page-conversation">
      <div className="page-header conversation-header">
        <div className="conversation-header-text">
          <h1>Conversation</h1>
          {counterpart ? (
            <p className="muted conversation-with">With {counterpart}</p>
          ) : data.booking_id ? (
            <p className="muted conversation-with">Booking #{data.booking_id}</p>
          ) : null}
        </div>
        {data.booking_id ? (
          <Link className="btn secondary" to={`/bookings/${data.booking_id}`}>
            View booking
          </Link>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {locked ? (
        <Alert tone="warning">Messaging is locked for this booking.</Alert>
      ) : null}

      <div className={`card chat${locked ? ' chat-locked' : ''}`}>
        <div className="chat-list" role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? <EmptyState title="No messages yet" /> : null}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`bubble${mine ? ' mine' : ''}`}>
                <div className="bubble-text">{m.message_text}</div>
                <div className="bubble-meta small">
                  <span className="bubble-sender">{m.sender?.full_name || (mine ? 'You' : 'Participant')}</span>
                  <span className="bubble-sep" aria-hidden="true">
                    ·
                  </span>
                  <time dateTime={m.created_at}>
                    {formatInZone(m.created_at, tz, { weekday: undefined, year: undefined })}
                  </time>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form className="chat-composer" onSubmit={send}>
          <div className="chat-composer-input">
            <label className="visually-hidden" htmlFor={`message-input-${id}`}>
              Message
            </label>
            <textarea
              id={`message-input-${id}`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              disabled={locked || busy}
              placeholder={locked ? 'Messaging is locked for this booking' : 'Write a message'}
              maxLength={CHAR_LIMITS.messageText}
              rows={2}
            />
            <CharacterCounter value={text} max={CHAR_LIMITS.messageText} subtle />
          </div>
          <button className="btn" type="submit" disabled={!canSend}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
