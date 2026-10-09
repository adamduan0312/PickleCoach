import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { homePathFor } from '../auth/paths.js';
import { LEGAL_DETAILS, PRIVACY_PATH, TERMS_PATH } from '../domain/legal.js';

function LegalPage({ title, children }) {
  const { user, mode, isAuthenticated } = useAuth();
  const home = isAuthenticated ? homePathFor(user, mode) : '/';
  return (
    <div className="page-narrow legal-page">
      <p className="small"><Link to={home}>← Back to PickleCoach</Link></p>
      <h1>{title}</h1>
      <p className="muted small">Effective {LEGAL_DETAILS.effectiveDate}</p>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function TermsPage() {
  const { companyName, contactEmail, governingLaw } = LEGAL_DETAILS;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These Terms govern your use of PickleCoach, operated by {companyName} (“PickleCoach”, “we”, “us”).
        By creating an account or using PickleCoach, you agree to these Terms and to our{' '}
        <Link to={PRIVACY_PATH}>Privacy Policy</Link>.
      </p>

      <Section title="1. Who can use PickleCoach">
        <p>You must be at least 18 years old to create an account or book or teach lessons.</p>
        <p>
          You agree to give accurate information, keep your login details secure, and use only your own account.
          You are responsible for activity on your account.
        </p>
      </Section>

      <Section title="2. What PickleCoach does">
        <p>
          PickleCoach is a marketplace that connects students with independent pickleball coaches. Coaches set their own
          lessons, prices, availability and court locations, and are responsible for the instruction they provide and for
          having access to the courts they list. PickleCoach does not provide lessons and is not a party to the
          instruction itself.
        </p>
        <p>Pickleball is a physical activity. You take part in lessons at your own risk.</p>
      </Section>

      <Section title="3. Bookings and payments">
        <ul>
          <li>Students pay the listed lesson price. Payments are processed by Stripe.</li>
          <li>
            When a student requests a lesson, their card is authorized but not charged. The card is charged when the coach
            accepts. If the coach declines or doesn’t respond in time, the authorization is released.
          </li>
          <li>
            Coaches are paid through Stripe after the lesson, once the period for reporting an issue has passed.
            PickleCoach keeps a commission from the lesson price. Coaches must complete Stripe’s onboarding to receive
            payouts.
          </li>
          <li>
            Cancellations, weather cancellations, attendance and issue reports follow the policy shown at checkout and on
            each booking. They only count when completed in PickleCoach — agreements made in messages, by text, or
            elsewhere don’t change a booking.
          </li>
          <li>
            Students can report an issue with a lesson or payment until 24 hours after the scheduled lesson ends.
            PickleCoach reviews reported issues and decides how they are resolved, including any refund.
          </li>
        </ul>
      </Section>

      <Section title="4. Stay on PickleCoach">
        <p>
          Keep communication, booking, and payment on PickleCoach. Don’t use PickleCoach to find a coach or student and
          then arrange or pay for lessons with them outside PickleCoach, and don’t exchange payment information in
          messages. Off-platform arrangements aren’t permitted and may result in loss of platform protections — such as
          refunds, issue reports and dispute review — and account restrictions.
        </p>
      </Section>

      <Section title="5. Prohibited conduct">
        <p>You agree not to:</p>
        <ul>
          <li>harass, threaten, or discriminate against other users;</li>
          <li>commit or attempt fraud, including false issue reports, false attendance reports, or chargeback abuse;</li>
          <li>post false or misleading information, reviews, or profiles, or impersonate anyone;</li>
          <li>use messaging for spam, solicitation, or anything unrelated to your PickleCoach lessons;</li>
          <li>interfere with, scrape, or attempt to gain unauthorized access to PickleCoach.</li>
        </ul>
      </Section>

      <Section title="6. Reviews and reliability">
        <p>
          Students may review coaches after a lesson; reviews are shown on coach profiles. PickleCoach keeps reliability
          records based on cancellations and attendance. Coach reliability scores are shown on coach profiles, and
          reliability records may be used when we review an account.
        </p>
      </Section>

      <Section title="7. Enforcement">
        <p>
          We may review accounts, bookings, payments and booking messages when an issue is reported, to resolve a dispute,
          or when we suspect fraud or a breach of these Terms. Depending on what we find, we may warn you, cancel or
          refund a booking, restrict features, or suspend or close your account. We don’t monitor every message and
          can’t guarantee that every breach will be detected.
        </p>
      </Section>

      <Section title="8. Closing your account">
        <p>
          You can ask us to close your account at any time by contacting {contactEmail}. Some records are kept after an
          account is closed, as described in our <Link to={PRIVACY_PATH}>Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="9. Disclaimers and limitation of liability">
        <p>
          PickleCoach is provided “as is”. To the extent permitted by law, PickleCoach is not liable for the conduct of
          coaches or students, for injuries or losses arising from lessons, or for indirect or consequential losses.
          Nothing in these Terms limits liability that cannot be limited by law.
        </p>
      </Section>

      <Section title="10. Governing law">
        <p>These Terms are governed by the laws of {governingLaw}.</p>
      </Section>

      <Section title="11. Changes and contact">
        <p>
          We may update these Terms. If we make material changes, we will let you know in PickleCoach or by email before
          they take effect. Questions: {contactEmail}.
        </p>
      </Section>
    </LegalPage>
  );
}

export function PrivacyPage() {
  const { companyName, contactEmail, hostingProvider } = LEGAL_DETAILS;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information {companyName} (“PickleCoach”, “we”) collects when you use PickleCoach, how
        it’s used, and who can see it. See also our <Link to={TERMS_PATH}>Terms of Service</Link>.
      </p>

      <Section title="Information we collect">
        <ul>
          <li>
            <strong>Account:</strong> name, email address, password (stored only as a secure hash), time zone, and
            optionally a phone number and profile photo.
          </li>
          <li>
            <strong>Coach profile:</strong> bio, photos, lessons and prices, availability, court locations, and the ID of
            your Stripe payout account.
          </li>
          <li>
            <strong>Bookings and payments:</strong> lesson, time, court, amounts, status, cancellations and their reasons,
            weather cancellation requests, attendance, issue reports, and reviews. Card details are collected and stored
            by Stripe — PickleCoach stores only Stripe’s payment references, not card numbers.
          </li>
          <li>
            <strong>Messages:</strong> messages you send to the other participant in a booking.
          </li>
          <li>
            <strong>Location:</strong> the ZIP code, city or address you search for, and — only if you allow it in your
            browser — your current location, used to find nearby coaches and courts.
          </li>
          <li>
            <strong>Technical:</strong> IP address and browser information recorded with account and booking actions, and
            server logs. Your login session and display preferences are stored in your browser. We don’t use advertising
            or analytics trackers.
          </li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>
          To run PickleCoach: create and secure accounts, show coach profiles, process bookings, payments, refunds and
          payouts, send booking emails and in-app notifications, calculate reliability, resolve issue reports and
          disputes, prevent fraud, and enforce our <Link to={TERMS_PATH}>Terms</Link>.
        </p>
      </Section>

      <Section title="Who can see your information">
        <ul>
          <li>
            <strong>The other person in a booking</strong> sees your name, photo, the booking details, and the messages
            you send them.
          </li>
          <li>
            <strong>Signed-in users</strong> can see coach profiles, including reviews and coach reliability scores.
          </li>
          <li>
            <strong>PickleCoach administrators</strong> can access accounts, bookings, payments and booking messages to
            support users, resolve issue reports and disputes, prevent fraud, and enforce our Terms.
          </li>
        </ul>
      </Section>

      <Section title="Messages">
        <p>
          Messages may be reviewed for safety, fraud prevention, and policy enforcement — for example when an issue is
          reported, during a dispute, or when we suspect fraud or off-platform arrangements. We don’t continuously
          monitor every message.
        </p>
      </Section>

      <Section title="Service providers">
        <ul>
          <li><strong>Stripe</strong> — payments, refunds, and coach payouts (including the identity checks Stripe requires for payouts).</li>
          <li><strong>SendGrid</strong> — sending account and booking emails.</li>
          <li>
            <strong>OpenStreetMap services (Nominatim, Photon, Overpass)</strong> — the location text or coordinates you
            search with are sent to these services to find places and courts.
          </li>
          <li><strong>{hostingProvider}</strong> — hosting our servers and database.</li>
        </ul>
        <p>We don’t sell your personal information.</p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep your information while your account is open. When an account is closed, it is deactivated, can no
          longer sign in, and a coach profile is no longer shown. Booking, payment, message, issue, review and audit
          records are kept as needed to resolve disputes, keep accurate financial records, prevent fraud, and meet legal
          obligations.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can update your profile in Settings. To access or correct your information, or to close your account,
          contact {contactEmail}.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Passwords are stored as secure hashes, and access to administrative tools is restricted to PickleCoach
          administrators. No system is completely secure, so please use a strong, unique password.
        </p>
      </Section>

      <Section title="Age">
        <p>PickleCoach is only for people aged 18 and over.</p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update this policy. If we make material changes, we will let you know in PickleCoach or by email.
          Questions: {contactEmail}.
        </p>
      </Section>
    </LegalPage>
  );
}
