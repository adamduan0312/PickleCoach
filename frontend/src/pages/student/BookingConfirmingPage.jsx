import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { bookingsApi } from '../../api/index.js';
import { Alert, LoadingState } from '../../components/ui/States.jsx';
import { bookingApiErrorCopy, bookingApiErrorMessage } from '../../domain/bookingErrors.js';

/** Handles Stripe redirect return_url after Payment Element. */
export function BookingConfirmingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const pi = params.get('pi') || params.get('payment_intent');
  const coachId = params.get('coach');
  const [error, setError] = useState(null);
  const confirmStartedRef = useRef(false);

  useEffect(() => {
    if (!pi || confirmStartedRef.current) return undefined;
    confirmStartedRef.current = true;

    async function finishConfirm() {
      try {
        const res = await bookingsApi.confirm(pi);
        const id = res.data?.booking?.id;
        navigate(id ? `/bookings/${id}` : '/bookings', { replace: true });
      } catch (err) {
        // A parallel confirm may have won; idempotent replay should succeed on retry.
        if (bookingApiErrorCopy(err)?.kind === 'slot_taken') {
          try {
            const retry = await bookingsApi.confirm(pi);
            const id = retry.data?.booking?.id;
            if (id) {
              navigate(`/bookings/${id}`, { replace: true });
              return;
            }
          } catch {
            // fall through to error UI
          }
        }
        setError(err);
      }
    }

    void finishConfirm();
    return undefined;
  }, [pi, navigate]);

  if (!pi) {
    return (
      <div className="page">
        <Alert tone="error">Missing payment intent.</Alert>
        <Link to="/bookings">Go to bookings</Link>
      </div>
    );
  }

  const scheduleCopy = bookingApiErrorCopy(error);
  const coachHref = coachId ? `/coaches/${coachId}` : null;

  return (
    <div className="page">
      {error ? (
        <>
          {scheduleCopy ? (
            <Alert tone="error">
              <strong>{scheduleCopy.title}</strong>
              <div className="small" style={{ marginTop: 6 }}>{scheduleCopy.body}</div>
            </Alert>
          ) : (
            <Alert tone="error">{bookingApiErrorMessage(error)}</Alert>
          )}
          <p className="row" style={{ marginTop: 12, gap: '0.75rem' }}>
            {scheduleCopy?.kind === 'student_schedule' ? (
              <>
                {coachHref ? <Link to={coachHref}>Choose another time</Link> : null}
                <Link to="/bookings">View my bookings</Link>
              </>
            ) : scheduleCopy?.kind === 'slot_taken' ? (
              coachHref
                ? <Link to={coachHref}>Choose another time</Link>
                : <Link to="/bookings">Go to bookings</Link>
            ) : (
              <>
                {coachHref ? <Link to={coachHref}>Back to coach</Link> : null}
                <Link to="/bookings">Go to bookings</Link>
              </>
            )}
          </p>
        </>
      ) : (
        <LoadingState label="Finishing authorization and sending your request to the coach…" />
      )}
    </div>
  );
}
