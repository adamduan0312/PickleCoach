import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { bookingsApi } from '../../api/index.js';
import { Alert, LoadingState } from '../../components/ui/States.jsx';

/** Handles Stripe redirect return_url after Payment Element. */
export function BookingConfirmingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pi = params.get('pi') || params.get('payment_intent');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pi) return undefined;
    let cancelled = false;
    bookingsApi.confirm(pi)
      .then((res) => {
        if (cancelled) return;
        const id = res.data?.booking?.id;
        navigate(id ? `/bookings/${id}?booked=1` : '/bookings', { replace: true });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [pi, navigate]);

  if (!pi) {
    return (
      <div className="page">
        <Alert tone="error">Missing payment intent.</Alert>
        <Link to="/bookings">Go to bookings</Link>
      </div>
    );
  }

  return (
    <div className="page">
      {error ? (
        <>
          <Alert tone="error">{error}</Alert>
          <Link to="/bookings">Go to bookings</Link>
        </>
      ) : (
        <LoadingState label="Finishing authorization and sending your request to the coach…" />
      )}
    </div>
  );
}
