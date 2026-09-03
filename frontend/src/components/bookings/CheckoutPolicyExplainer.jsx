import {
  checkoutAcceptancePolicyCopy,
  checkoutCancellationNoShowPolicyLines,
  coachAcceptanceTimeoutHours,
  minBookingLeadHours,
} from '../../domain/bookingStatus.js';

export function CheckoutPolicyExplainer({ amountLabel }) {
  const acceptanceCopy = checkoutAcceptancePolicyCopy({
    coach_acceptance_timeout_hours: coachAcceptanceTimeoutHours({}),
    min_booking_lead_hours: minBookingLeadHours({}),
  });
  const cancelLines = checkoutCancellationNoShowPolicyLines();

  return (
    <div className="checkout-policy-stack">
      <div className="checkout-auth-explainer">
        <h3 className="checkout-auth-explainer-title">What happens when you authorize</h3>
        <ul className="checkout-auth-explainer-list">
          <li>Your card is authorized for {amountLabel} — you are not charged yet.</li>
          <li>{acceptanceCopy}</li>
          <li>If the coach declines or does not respond in time, the authorization is released.</li>
          <li>After the lesson, you have 24 hours to report a payment or lesson problem before payment is normally finalized.</li>
        </ul>
      </div>
      <div className="checkout-auth-explainer">
        <h3 className="checkout-auth-explainer-title">Cancellation &amp; no-show policy</h3>
        <ul className="checkout-auth-explainer-list">
          {cancelLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
