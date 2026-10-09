import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BENEFITS_HEADING,
  CHECKOUT_BENEFITS,
  COACH_BENEFITS,
  COACH_PENDING_BENEFITS_STEP,
  STUDENT_BENEFITS,
} from '../src/domain/platformBenefits.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ALL_COPY = [
  ...STUDENT_BENEFITS.flatMap((b) => [b.title, b.body]),
  ...COACH_BENEFITS.flatMap((b) => [b.title, b.body]),
  ...CHECKOUT_BENEFITS,
  COACH_PENDING_BENEFITS_STEP.title,
  COACH_PENDING_BENEFITS_STEP.body,
].join('\n');

test('benefits never promise outcomes or reveal reliability mechanics', () => {
  assert.doesNotMatch(ALL_COPY, /guarantee|always|every (lesson|dispute|complaint)|full refund|more students|earn/i);
  assert.doesNotMatch(ALL_COPY, /sick|emergenc|exempt|penalt|weight/i);
  assert.match(ALL_COPY, /applicable/, 'refund wording stays conditional');
});

test('landing page: student and coach benefits after the hero, before the footer', () => {
  const src = read('../src/pages/LandingPage.jsx');
  const hero = src.indexOf('className="hero"');
  const benefits = src.indexOf('className="landing-benefits"');
  assert.ok(hero < benefits && benefits < src.indexOf('legal-footer'));
  assert.match(src, /<BenefitList heading="For students" items=\{STUDENT_BENEFITS\} \/>/);
  assert.match(src, /<BenefitList heading="For coaches" items=\{COACH_BENEFITS\} \/>/);
  assert.equal(BENEFITS_HEADING, 'Book with confidence on PickleCoach');
});

test('checkout: one box with the benefits and the existing stay-on-platform rule, after the cancellation policy', () => {
  const src = read('../src/components/bookings/CheckoutPolicyExplainer.jsx');
  const policy = src.indexOf('Cancellation &amp; no-show policy');
  const box = src.slice(src.indexOf('{CHECKOUT_BENEFITS_TITLE}'));
  assert.ok(policy > -1 && policy < src.indexOf('{CHECKOUT_BENEFITS_TITLE}'));
  assert.match(box, /CHECKOUT_BENEFITS\.map/);
  assert.match(box, /<strong>\{STAY_ON_PLATFORM_TITLE\}\.<\/strong> \{STAY_ON_PLATFORM_BODY\}/);
  assert.equal(src.split('{STAY_ON_PLATFORM_BODY}').length - 1, 1, 'warning not repeated');
});

test('coach pending request: benefits step after the existing instructions; chat stays operational', () => {
  const detail = read('../src/pages/bookings/BookingDetailPage.jsx');
  const steps = detail.slice(detail.indexOf('function bookingDetailNextSteps'));
  const pendingCoach = steps.slice(steps.indexOf("case 'pending':"), steps.indexOf("case 'confirmed':"));
  const order = ['Accept or decline', 'COACH_PENDING_IN_APP_STEP', 'COACH_PENDING_STAY_ON_PLATFORM_STEP', 'COACH_PENDING_BENEFITS_STEP']
    .map((s) => pendingCoach.indexOf(s));
  assert.ok(order.every((i, n) => i > -1 && (n === 0 || i > order[n - 1])), String(order));

  const messages = read('../src/pages/messages/MessagesPages.jsx');
  assert.doesNotMatch(messages, /platformBenefits|BENEFITS/);
});
