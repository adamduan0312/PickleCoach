import { Link } from 'react-router-dom';
import {
  checkoutAcceptancePolicyCopy,
  checkoutCancellationNoShowPolicyLines,
  coachAcceptanceTimeoutHours,
  minBookingLeadHours,
} from '../../domain/bookingStatus.js';
import { IN_APP_BOOKING_CHANGES_LINE, STAY_ON_PLATFORM_BODY, STAY_ON_PLATFORM_TITLE } from '../../domain/cancellationPolicy.js';
import { TERMS_PATH } from '../../domain/legal.js';
import { CHECKOUT_BENEFITS, CHECKOUT_BENEFITS_TITLE } from '../../domain/platformBenefits.js';

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
          <li>After your lesson: you’ll have 24 hours after the scheduled lesson ends to report an issue with the lesson or payment before payment is normally finalized.</li>
        </ul>
      </div>
      <div className="checkout-auth-explainer">
        <h3 className="checkout-auth-explainer-title">Cancellation &amp; no-show policy</h3>
        <ul className="checkout-auth-explainer-list">
          {cancelLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="checkout-in-app-rule"><strong>{IN_APP_BOOKING_CHANGES_LINE}</strong></p>
      </div>
      <div className="checkout-auth-explainer">
        <h3 className="checkout-auth-explainer-title">{CHECKOUT_BENEFITS_TITLE}</h3>
        <ul className="checkout-auth-explainer-list">
          {CHECKOUT_BENEFITS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="checkout-in-app-rule">
          <strong>{STAY_ON_PLATFORM_TITLE}.</strong> {STAY_ON_PLATFORM_BODY} See the <Link to={TERMS_PATH}>Terms of Service</Link>.
        </p>
      </div>
    </div>
  );
}
