/**
 * Public site copy: homepage, About, FAQ. Answers reuse the same policy helpers as checkout and
 * booking pages so the FAQ can't drift from what the app actually does.
 */
import { checkoutAcceptancePolicyCopy } from './bookingStatus.js';
import {
  COACH_WEATHER_POLICY_LINE,
  STUDENT_WEATHER_POLICY_LINE,
  WEATHER_TIMING_POLICY_LINE,
  coachCancellationPolicyLines,
  studentCancellationPolicyLines,
} from './cancellationPolicy.js';

export const SITE_TAGLINE = 'Find your pickleball coach. Play with confidence.';

export const HOME_SUBHEADING =
  'Compare coach profiles, reviews, and reliability scores. Find a teaching location, book your lesson, and manage everything in one place.';

export const FIND_COACH_PATH = '/register?role=student';
export const BECOME_COACH_PATH = '/register?role=coach';
export const FAQ_PATH = '/faq';
export const CONTACT_ANCHOR = 'contact';
export const ABOUT_ANCHOR = 'about';

export const ABOUT_TEXT =
  'PickleCoach is a marketplace for in-person pickleball lessons. Students find and book local coaches; coaches list their lessons, teaching locations, and availability, and manage bookings and payments in one place.';

export const HOW_IT_WORKS = [
  { title: 'Find a coach', body: 'Browse coaches near you and compare profiles, reviews, and reliability scores.' },
  { title: 'Request a lesson', body: 'Pick a lesson, time, and teaching location. Your card is authorized, not charged, until the coach accepts.' },
  { title: 'Play', body: 'Meet your coach on the court. Cancellations, weather requests, and issue reports are handled in PickleCoach.' },
];

const STUDENT_NO_SHOW_FAQ_LINE = 'If you don’t show up, your payment isn’t automatically refunded.';

function studentFaqCancellationLines() {
  return studentCancellationPolicyLines()
    .filter((line) => line !== STUDENT_WEATHER_POLICY_LINE && line !== WEATHER_TIMING_POLICY_LINE)
    .map((line) => (line.startsWith('If you don’t show up') ? STUDENT_NO_SHOW_FAQ_LINE : line))
    .concat('Please attend the lessons you book. If you can’t make it, cancel through PickleCoach as early as you can.');
}

export const COACH_INFO_NOTICE =
  'Coach profiles — including experience, certifications, and skill ratings — are provided by coaches. PickleCoach doesn’t verify credentials or skill ratings and doesn’t run background checks. Review a coach’s profile, reviews, and reliability score before booking.';

export const STUDENT_FAQ = [
  {
    q: 'How does payment work?',
    a: [
      'You pay the listed lesson price — there’s no added booking fee. Payments are processed by Stripe.',
      'When you request a lesson, your card is authorized but not charged. It’s charged when the coach accepts. If the coach declines or doesn’t respond in time, the authorization is released.',
    ],
  },
  {
    q: 'How long does a coach have to accept?',
    a: [checkoutAcceptancePolicyCopy()],
  },
  {
    q: 'What if I need to cancel?',
    a: studentFaqCancellationLines(),
  },
  {
    q: 'What if the weather is bad?',
    a: [WEATHER_TIMING_POLICY_LINE, STUDENT_WEATHER_POLICY_LINE],
  },
  {
    q: 'Can I reschedule?',
    a: ['There is no reschedule option. To change the time, cancel the booking and book a new slot.'],
  },
  {
    q: 'What if something goes wrong with my lesson?',
    a: [
      'You can report an issue with a lesson or payment from the booking page until 24 hours after the scheduled lesson ends. PickleCoach reviews reported issues and decides how they’re resolved, including any refund.',
    ],
  },
  {
    q: 'Does PickleCoach verify coaches?',
    a: [COACH_INFO_NOTICE],
  },
];

export const COACH_FAQ = [
  {
    q: 'How do I start coaching on PickleCoach?',
    a: [
      'Create an account as a coach, then complete your profile, set up payouts with Stripe, add at least one lesson, add a teaching location, and set your availability. Students can find and book you once these steps are done.',
    ],
  },
  {
    q: 'How do lesson requests work?',
    a: [
      checkoutAcceptancePolicyCopy(),
      'Accepting charges the student’s card. Declining or missing the deadline releases the authorization.',
    ],
  },
  {
    q: 'How do I get paid?',
    a: [
      'You’re paid through Stripe after the lesson, once the 24-hour period for reporting an issue has passed. PickleCoach keeps a commission from the lesson price.',
    ],
  },
  {
    q: 'What if I or the student need to cancel?',
    a: coachCancellationPolicyLines().filter((line) => line !== COACH_WEATHER_POLICY_LINE && line !== WEATHER_TIMING_POLICY_LINE),
  },
  {
    q: 'What if the weather is bad?',
    a: [WEATHER_TIMING_POLICY_LINE, COACH_WEATHER_POLICY_LINE],
  },
];
