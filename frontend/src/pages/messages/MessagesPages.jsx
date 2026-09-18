import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { messagesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { EmptyState, ErrorState, LoadingState, Alert } from '../../components/ui/States.jsx';
import { CharacterCounter } from '../../components/ui/CharacterLimit.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatInZone, detectLocalTimezone, relativeFromNow } from '../../utils/datetime.js';
import { conversationClosedNotice } from '../../domain/bookingStatus.js';

function bookingContextLabel(bookingId, scheduledAt, timeZone) {
  const parts = [];
  if (bookingId != null) parts.push(`Booking #${bookingId}`);
  if (scheduledAt) {
    parts.push(
      formatInZone(scheduledAt, timeZone, {
        weekday: undefined,
        year: undefined,
      }),
    );
  }
  return parts.length ? parts.join(' · ') : null;
}

export function ConversationsPage() {
  const { user } = useAuth();
  const tz = user?.timezone || detectLocalTimezone();
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
            const counterpartName = c.counterpart?.full_name?.trim() || null;
            const title = counterpartName || `Booking #${c.booking_id}`;
            const context = counterpartName
              ? bookingContextLabel(c.booking_id, c.booking?.scheduled_at, tz)
              : bookingContextLabel(null, c.booking?.scheduled_at, tz);
            const preview = c.latest_message?.message_text?.trim();
            const hasPreview = Boolean(preview);
            const latestAt = c.latest_message?.created_at;
            const relative = latestAt ? relativeFromNow(latestAt) : '';
            return (
              <Link
                key={c.id}
                to={`/messages/${c.id}`}
                className="card clickable messages-inbox-card"
              >
                <div className="spread messages-inbox-card-top">
                  <strong className="messages-inbox-name">{title}</strong>
                  {c.unread_count > 0 ? (
                    <span className="badge warning">{c.unread_count} unread</span>
                  ) : null}
                </div>
                {context ? <p className="muted messages-inbox-context">{context}</p> : null}
                <div className="spread messages-inbox-card-bottom">
                  <p className={`messages-inbox-preview${hasPreview ? '' : ' muted'}`}>
                    {hasPreview ? preview : 'No messages yet'}
                  </p>
                  {relative ? (
                    <time className="small muted messages-inbox-time" dateTime={latestAt}>
                      {relative}
                    </time>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function isChatListNearBottom(listEl, thresholdPx = 80) {
  if (!listEl) return true;
  return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= thresholdPx;
}

function scrollChatListToBottom(listEl, { smooth = false } = {}) {
  if (!listEl) return;
  listEl.scrollTo({
    top: listEl.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

export function ConversationPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const chatListRef = useRef(null);
  const initialThreadReadyRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const stickToBottomAfterSendRef = useRef(false);
  const { data, error: loadError, loading, setData } = useAsync(async () => {
    const res = await messagesApi.conversation(id);
    return res.data;
  }, [id]);

  useEffect(() => {
    initialThreadReadyRef.current = false;
    prevMessageCountRef.current = 0;
    stickToBottomAfterSendRef.current = false;
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
    if (loading || !data) return;
    const count = Array.isArray(data.messages) ? data.messages.length : 0;
    const listEl = chatListRef.current;
    if (!listEl) return;

    if (!initialThreadReadyRef.current) {
      initialThreadReadyRef.current = true;
      prevMessageCountRef.current = count;
      // Show latest messages inside the chat pane only — never scroll the document.
      requestAnimationFrame(() => {
        scrollChatListToBottom(chatListRef.current, { smooth: false });
      });
      return;
    }

    if (count <= prevMessageCountRef.current) {
      prevMessageCountRef.current = count;
      stickToBottomAfterSendRef.current = false;
      return;
    }

    const forceStick = stickToBottomAfterSendRef.current;
    stickToBottomAfterSendRef.current = false;
    const shouldStick = forceStick || isChatListNearBottom(listEl);
    prevMessageCountRef.current = count;
    if (shouldStick) {
      requestAnimationFrame(() => {
        scrollChatListToBottom(chatListRef.current, { smooth: true });
      });
    }
  }, [loading, data, data?.messages?.length]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await messagesApi.send({ conversation_id: Number(id), message_text: text.trim() });
      setText('');
      stickToBottomAfterSendRef.current = true;
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
  const closedNotice = conversationClosedNotice(data.booking);
  const messages = data.messages || [];
  const tz = user?.timezone || detectLocalTimezone();
  const counterpartName = data.counterpart?.full_name?.trim() || null;
  const heading = counterpartName
    || (data.booking_id != null ? `Booking #${data.booking_id}` : 'Conversation');
  const context = counterpartName
    ? bookingContextLabel(data.booking_id, data.booking?.scheduled_at, tz)
    : bookingContextLabel(null, data.booking?.scheduled_at, tz);
  const canSend = !locked && !busy && Boolean(text.trim());

  return (
    <div className="page page-conversation">
      <div className="page-header conversation-header">
        <div className="conversation-header-text">
          <h1>{heading}</h1>
          {context ? <p className="muted conversation-context">{context}</p> : null}
        </div>
        {data.booking_id ? (
          <Link className="btn secondary" to={`/bookings/${data.booking_id}`}>
            View booking
          </Link>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {locked && closedNotice ? (
        <Alert tone="info">{closedNotice}</Alert>
      ) : null}

      <div className={`card chat${locked ? ' chat-locked' : ''}`}>
        <div
          ref={chatListRef}
          className="chat-list"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
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
        </div>

        {!locked ? (
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
                disabled={busy}
                placeholder="Write a message"
                maxLength={CHAR_LIMITS.messageText}
                rows={2}
              />
              <CharacterCounter value={text} max={CHAR_LIMITS.messageText} subtle />
            </div>
            <button className="btn" type="submit" disabled={!canSend}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
