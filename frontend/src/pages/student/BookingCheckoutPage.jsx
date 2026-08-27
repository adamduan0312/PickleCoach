import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { bookingsApi, coachesApi, asList } from '../../api/index.js';
import { Alert, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { formatMoney, courtLabel, teachingLocationLabel } from '../../utils/format.js';
import { formatDateInZone, formatTimeInZone, detectLocalTimezone } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { pendingRequestTimeoutCopy, coachAcceptanceTimeoutHours, minBookingLeadHours } from '../../domain/bookingStatus.js';

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;
const isStripeTestMode = String(STRIPE_PUBLISHABLE_KEY).startsWith('pk_test_');

/** Student-facing where line: "Weston — Court Name" when possible. */
function checkoutWhereLabel(court) {
  if (!court) return 'Court TBD';
  const name = court.name || 'Court';
  const area = teachingLocationLabel(court);
  if (area) {
    const city = String(area).split(',')[0].trim();
    return city ? `${city} — ${name}` : `${area} — ${name}`;
  }
  return courtLabel(court);
}

export function BookingCheckoutPage() {
  const { coachId } = useParams();
  const [params] = useSearchParams();
  const lessonId = params.get('lesson');
  const courtId = params.get('court');
  const scheduledAt = params.get('at');
  const { user } = useAuth();
  const tz = user?.timezone || detectLocalTimezone();
  const missingParams = !lessonId || !courtId || !scheduledAt;
  const [intent, setIntent] = useState(null);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (missingParams) return undefined;
    let cancelled = false;
    async function start() {
      try {
        // Students must load offerings via coach catalog — GET /lessons/:id is owner/admin only.
        const [lessonsRes, coachRes, courtsRes] = await Promise.all([
          coachesApi.getLessons(coachId),
          coachesApi.getById(coachId),
          coachesApi.getCourts(coachId),
        ]);
        if (cancelled) return;
        const lesson = asList(lessonsRes.data).find((l) => String(l.id) === String(lessonId));
        if (!lesson) {
          throw new Error('That lesson is not available from this coach. Go back and pick another offering.');
        }
        const courts = asList(courtsRes.data);
        const court = courts.find((c) => String(c.court_id || c.id) === String(courtId));
        setMeta({
          lesson,
          coach: coachRes.data,
          court,
        });
        const idem = `pc_${user.id}_${lessonId}_${scheduledAt}_${courtId}`.slice(0, 255);
        const created = await bookingsApi.createIntent({
          lesson_id: Number(lessonId),
          scheduled_at: scheduledAt,
          court_location_id: Number(courtId),
          payment_method: 'stripe',
          idempotency_key: idem,
        }, idem);
        if (cancelled) return;
        setIntent(created.data);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }
    start();
    return () => { cancelled = true; };
  }, [missingParams, coachId, lessonId, courtId, scheduledAt, user?.id]);

  if (missingParams) {
    return (
      <div className="page checkout-page">
        <h1>Checkout</h1>
        <ErrorState error="Missing lesson, court, or time. Go back and choose a slot." />
        <Link to={`/coaches/${coachId}`}>Back to coach</Link>
      </div>
    );
  }

  if (error && !intent) {
    return (
      <div className="page checkout-page">
        <h1>Checkout</h1>
        {meta ? <BookingSummary meta={meta} scheduledAt={scheduledAt} tz={tz} amount={null} currency={null} /> : null}
        <ErrorState error={error} />
        <Link to={`/coaches/${coachId}`}>Back to coach</Link>
      </div>
    );
  }

  if (!intent) {
    return (
      <div className="page checkout-page">
        <h1>Checkout</h1>
        {meta ? <BookingSummary meta={meta} scheduledAt={scheduledAt} tz={tz} amount={meta.lesson?.price} currency="USD" /> : null}
        <LoadingState label="Preparing payment authorization…" />
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="page checkout-page">
        <Alert tone="error">
          Stripe publishable key is not configured. Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the frontend env (pk_test_…).
        </Alert>
      </div>
    );
  }

  const amount = intent.amount;
  const currency = intent.currency;

  return (
    <div className="page checkout-page">
      <h1>Checkout</h1>
      <p className="muted checkout-lead">Review your booking, then authorize payment to send the request to the coach.</p>

      {meta ? (
        <BookingSummary meta={meta} scheduledAt={scheduledAt} tz={tz} amount={amount} currency={currency} />
      ) : null}

      <section className="card checkout-payment" aria-labelledby="checkout-payment-heading">
        <h2 id="checkout-payment-heading">Payment</h2>
        <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
          <CheckoutForm intent={intent} />
        </Elements>
      </section>

      <p className="small muted" style={{ marginTop: 16 }}>
        <Link to={`/coaches/${coachId}`}>Back to coach</Link>
      </p>
    </div>
  );
}

function BookingSummary({ meta, scheduledAt, tz, amount, currency }) {
  const coach = meta.coach;
  const lesson = meta.lesson;
  const profile = coach?.coachProfile || {};
  const whenLabel = scheduledAt
    ? `${formatDateInZone(scheduledAt, tz)} · ${formatTimeInZone(scheduledAt, tz)}`
    : '—';
  const total = amount != null ? formatMoney(amount, currency || 'USD') : formatMoney(lesson?.price);

  return (
    <section className="card checkout-summary" aria-labelledby="checkout-summary-heading">
      <h2 id="checkout-summary-heading">You&apos;re booking</h2>

      <div className="checkout-summary-coach">
        <Avatar name={coach?.full_name} src={coach?.avatar_url} size="lg" />
        <div>
          <div className="checkout-summary-coach-name">{coach?.full_name || 'Coach'}</div>
          {profile.headline ? <div className="small muted">{profile.headline}</div> : null}
        </div>
      </div>

      <dl className="checkout-summary-list">
        <div>
          <dt>Lesson</dt>
          <dd>
            {lesson?.title || 'Lesson'}
            {lesson?.duration_minutes != null ? ` · ${lesson.duration_minutes} minutes` : null}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{whenLabel}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{checkoutWhereLabel(meta.court)}</dd>
        </div>
        <div className="checkout-summary-total">
          <dt>Total</dt>
          <dd>{total}</dd>
        </div>
      </dl>
    </section>
  );
}

function CheckoutForm({ intent }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const returnUrl = useMemo(
    () => `${window.location.origin}/bookings/confirming?pi=${encodeURIComponent(intent.payment_intent_id)}`,
    [intent.payment_intent_id],
  );

  const amountLabel = formatMoney(intent.amount, intent.currency);

  async function onSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });
      if (result.error) {
        setError(result.error.message);
        setBusy(false);
        return;
      }
      const confirmed = await bookingsApi.confirm(intent.payment_intent_id);
      const bookingId = confirmed.data?.booking?.id;
      navigate(bookingId ? `/bookings/${bookingId}?booked=1` : '/bookings');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="stack checkout-payment-form" onSubmit={onSubmit}>
      <PaymentElement />

      <div className="checkout-auth-explainer">
        <h3 className="checkout-auth-explainer-title">What happens when you authorize</h3>
        <ul className="checkout-auth-explainer-list">
          <li>Your card is authorized for {amountLabel} — you are not charged yet.</li>
          <li>
            {pendingRequestTimeoutCopy(
              {
                coach_acceptance_timeout_hours: coachAcceptanceTimeoutHours({}),
                min_booking_lead_hours: minBookingLeadHours({}),
              },
              { audience: 'student' },
            )}
          </li>
          <li>If the coach declines or does not respond in time, the authorization is released.</li>
          <li>After the lesson, you have 24 hours to report a payment or lesson problem before payment is normally finalized.</li>
        </ul>
      </div>

      <Alert tone="error">{error}</Alert>

      <button className="btn checkout-authorize-cta" type="submit" disabled={!stripe || busy}>
        {busy ? 'Authorizing…' : `Authorize ${amountLabel}`}
      </button>

      {isStripeTestMode ? (
        <p className="small muted checkout-test-hint">
          Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.
        </p>
      ) : null}
    </form>
  );
}
