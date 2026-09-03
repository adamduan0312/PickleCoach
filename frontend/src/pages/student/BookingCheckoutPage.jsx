import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { bookingsApi, coachesApi, asList } from '../../api/index.js';
import { Alert, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { formatMoney, courtLabel, teachingLocationLabel } from '../../utils/format.js';
import { formatDateInZone, formatTimeInZone, detectLocalTimezone } from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { CheckoutPolicyExplainer } from '../../components/bookings/CheckoutPolicyExplainer.jsx';
import { bookingApiErrorCopy, bookingApiErrorMessage, stripePaymentFormErrorCopy } from '../../domain/bookingErrors.js';

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

  const stripeElementsOptions = useMemo(
    () => (intent?.client_secret ? { clientSecret: intent.client_secret } : null),
    [intent?.client_secret],
  );

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
    const scheduleCopy = bookingApiErrorCopy(error);
    return (
      <div className="page checkout-page">
        <h1>Checkout</h1>
        {meta ? <BookingSummary meta={meta} scheduledAt={scheduledAt} tz={tz} amount={null} currency={null} /> : null}
        {scheduleCopy ? (
          <div className="error-box">
            <div className="alert error">
              <strong>{scheduleCopy.title}</strong>
              <div className="small" style={{ marginTop: 6 }}>{scheduleCopy.body}</div>
            </div>
          </div>
        ) : (
          <ErrorState error={bookingApiErrorMessage(error)} />
        )}
        <BookingScheduleErrorRecovery kind={scheduleCopy?.kind} coachId={coachId} />
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
        {stripeElementsOptions ? (
          <Elements stripe={stripePromise} options={stripeElementsOptions}>
            <CheckoutForm intent={intent} coachId={coachId} />
          </Elements>
        ) : null}
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

function BookingScheduleErrorRecovery({ kind, coachId }) {
  const coachHref = coachId ? `/coaches/${coachId}` : null;
  if (kind === 'student_schedule') {
    return (
      <p className="row" style={{ marginTop: 12, gap: '0.75rem' }}>
        {coachHref ? <Link to={coachHref}>Choose another time</Link> : null}
        <Link to="/bookings">View my bookings</Link>
      </p>
    );
  }
  if (kind === 'slot_taken') {
    return (
      <p style={{ marginTop: 12 }}>
        {coachHref
          ? <Link to={coachHref}>Choose another time</Link>
          : <Link to="/bookings">Go to bookings</Link>}
      </p>
    );
  }
  return (
    <p style={{ marginTop: 12 }}>
      {coachHref
        ? <Link to={coachHref}>Back to coach</Link>
        : <Link to="/bookings">Go to bookings</Link>}
    </p>
  );
}

function CheckoutForm({ intent, coachId }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [busyPhase, setBusyPhase] = useState(null);
  const [error, setError] = useState(null);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [paymentElementLoadError, setPaymentElementLoadError] = useState(null);
  const submitStartedRef = useRef(false);

  useEffect(() => {
    setPaymentElementReady(false);
    setPaymentElementLoadError(null);
  }, [intent.client_secret]);

  const confirmingHref = useMemo(() => {
    const q = new URLSearchParams({
      pi: intent.payment_intent_id,
    });
    if (coachId) q.set('coach', String(coachId));
    return `/bookings/confirming?${q.toString()}`;
  }, [intent.payment_intent_id, coachId]);

  const returnUrl = useMemo(
    () => `${window.location.origin}${confirmingHref}`,
    [confirmingHref],
  );

  const amountLabel = formatMoney(intent.amount, intent.currency);
  const canAuthorize = Boolean(stripe && elements && paymentElementReady && !paymentElementLoadError && !busy);

  async function onSubmit(e) {
    e.preventDefault();
    if (!canAuthorize || submitStartedRef.current) return;
    submitStartedRef.current = true;
    setBusy(true);
    setBusyPhase('authorize');
    setError(null);
    try {
      const submitted = await elements.submit();
      if (submitted?.error) {
        setError(submitted.error);
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });
      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.paymentIntent?.status === 'requires_action') {
        navigate(confirmingHref, { replace: true });
        return;
      }

      setBusyPhase('confirm');
      const confirmRes = await bookingsApi.confirm(intent.payment_intent_id);
      const bookingId = confirmRes.data?.booking?.id;
      navigate(bookingId ? `/bookings/${bookingId}` : '/bookings', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setBusyPhase(null);
      submitStartedRef.current = false;
    }
  }

  const scheduleCopy = bookingApiErrorCopy(error);
  const stripeFormCopy = !scheduleCopy ? stripePaymentFormErrorCopy(error) : null;
  const errorMessage = error && !scheduleCopy && !stripeFormCopy
    ? bookingApiErrorMessage(error)
    : null;
  const loadFailureCopy = paymentElementLoadError
    ? stripePaymentFormErrorCopy(paymentElementLoadError)
      || {
        title: 'Payment form isn’t ready.',
        body: 'Check your connection, then refresh this page and try again.',
      }
    : null;

  return (
    <form className="stack checkout-payment-form" onSubmit={onSubmit}>
      <PaymentElement
        onReady={() => {
          setPaymentElementReady(true);
          setPaymentElementLoadError(null);
        }}
        onLoadError={(event) => {
          const loadErr = event?.error || event || new Error('Payment form failed to load.');
          setPaymentElementReady(false);
          setPaymentElementLoadError(loadErr);
        }}
      />

      {!paymentElementReady && !paymentElementLoadError ? (
        <p className="small muted" role="status">Payment form is still loading…</p>
      ) : null}

      <CheckoutPolicyExplainer amountLabel={amountLabel} />

      {scheduleCopy ? (
        <Alert tone="error">
          <strong>{scheduleCopy.title}</strong>
          <div className="small" style={{ marginTop: 6 }}>{scheduleCopy.body}</div>
        </Alert>
      ) : loadFailureCopy ? (
        <Alert tone="error">
          <strong>{loadFailureCopy.title}</strong>
          <div className="small" style={{ marginTop: 6 }}>{loadFailureCopy.body}</div>
        </Alert>
      ) : stripeFormCopy ? (
        <Alert tone="error">
          <strong>{stripeFormCopy.title}</strong>
          <div className="small" style={{ marginTop: 6 }}>{stripeFormCopy.body}</div>
        </Alert>
      ) : (
        <Alert tone="error">{errorMessage}</Alert>
      )}

      {scheduleCopy ? (
        <BookingScheduleErrorRecovery kind={scheduleCopy.kind} coachId={coachId} />
      ) : null}

      <button className="btn checkout-authorize-cta" type="submit" disabled={!canAuthorize}>
        {busy
          ? (busyPhase === 'confirm' ? 'Completing booking…' : 'Authorizing…')
          : `Authorize ${amountLabel}`}
      </button>

      {isStripeTestMode ? (
        <p className="small muted checkout-test-hint">
          Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.
        </p>
      ) : null}
    </form>
  );
}
