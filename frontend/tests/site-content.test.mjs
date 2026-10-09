import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BECOME_COACH_PATH,
  COACH_FAQ,
  COACH_INFO_NOTICE,
  FIND_COACH_PATH,
  HOME_SUBHEADING,
  SITE_TAGLINE,
  STUDENT_FAQ,
} from '../src/domain/siteContent.js';
import { studentCancellationPolicyLines } from '../src/domain/cancellationPolicy.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const faqText = (items) => items.flatMap(({ q, a }) => [q, ...a]).join('\n');
const STUDENT_TEXT = faqText(STUDENT_FAQ);
const COACH_TEXT = faqText(COACH_FAQ);

test('homepage: headline, subtext, Find a coach and Become a coach, About section', () => {
  assert.equal(SITE_TAGLINE, 'Find your pickleball coach. Play with confidence.');
  assert.equal(
    HOME_SUBHEADING,
    'Compare coach profiles, reviews, and reliability scores. Find a teaching location, book your lesson, and manage everything in one place.',
  );
  const src = read('../src/pages/LandingPage.jsx');
  assert.match(src, /<Link className="btn" to=\{FIND_COACH_PATH\}>Find a coach<\/Link>/);
  assert.match(src, /to=\{BECOME_COACH_PATH\}>Become a coach<\/Link>/);
  assert.match(src, /id=\{ABOUT_ANCHOR\}/);
  assert.equal(BECOME_COACH_PATH, '/register?role=coach');
  assert.equal(FIND_COACH_PATH, '/register?role=student');
});

test('register preselects coach from ?role=coach', () => {
  assert.match(read('../src/pages/auth/RegisterPage.jsx'), /role: searchParams\.get\('role'\) === 'coach' \? 'coach' : 'student'/);
});

test('FAQ is a public route with a contact section', () => {
  const app = read('../src/App.jsx');
  assert.match(app, /<Route path=\{FAQ_PATH\} element=\{<FaqPage \/>\} \/>/);
  assert.ok(app.indexOf('<FaqPage />') < app.indexOf('<ShellLayout />'));
  const page = read('../src/pages/FaqPage.jsx');
  assert.match(page, /id=\{CONTACT_ANCHOR\}/);
  assert.match(page, /email\.includes\('@'\) \? <a href=\{`mailto:\$\{email\}`\}>/, 'no mailto link to a placeholder');
});

test('footer has the requested groups and links', () => {
  const src = read('../src/components/layout/PublicFooter.jsx');
  for (const label of ['Explore', 'Help', 'About', 'Legal', 'Discover coaches', 'Become a coach', 'FAQ', 'Contact support', 'About PickleCoach', 'Terms of Service', 'Privacy Policy']) {
    assert.ok(src.includes(`>${label}<`), label);
  }
  assert.match(src, /© \{YEAR\} PickleCoach/);
  for (const page of ['LandingPage.jsx', 'FaqPage.jsx', 'LegalPages.jsx']) {
    assert.match(read(`../src/pages/${page}`), /<PublicFooter \/>/, page);
  }
});

test('coach info notice is accurate: no verification or quality claims', () => {
  assert.match(COACH_INFO_NOTICE, /provided by coaches/);
  assert.match(COACH_INFO_NOTICE, /doesn’t verify credentials or skill ratings and doesn’t run background checks/);
  assert.match(COACH_INFO_NOTICE, /Review a coach’s profile, reviews, and reliability score before booking/);
  const all = `${STUDENT_TEXT}\n${COACH_TEXT}\n${read('../src/pages/LandingPage.jsx')}`;
  assert.doesNotMatch(all, /verified coach|vetted|background-checked|certified coaches|guarantee/i);
  assert.doesNotMatch(all, /online lesson|virtual lesson/i);
});

test('student FAQ matches how bookings actually work', () => {
  assert.match(STUDENT_TEXT, /authorized but not charged/);
  assert.match(STUDENT_TEXT, /up to 24 hours to accept, but must accept at least 2 hours before/);
  assert.match(STUDENT_TEXT, /50%/);
  assert.match(STUDENT_TEXT, /Inside 24 hours, both sides must agree to a weather cancellation/);
  assert.match(STUDENT_TEXT, /until 24 hours after the scheduled lesson ends/);
  const ownWords = STUDENT_FAQ.flatMap(({ q, a }) => [q, ...a])
    .filter((line) => line !== COACH_INFO_NOTICE && !studentCancellationPolicyLines().includes(line));
  assert.doesNotMatch(ownWords.join('\n'), /reliability/i, 'no reliability wording beyond the shared checkout policy');
  assert.doesNotMatch(STUDENT_TEXT, /sick|emergenc/i, 'reliability-neutral reasons stay unlisted');
});

test('coach FAQ covers setup, requests, payouts and cancellations', () => {
  assert.match(COACH_TEXT, /set up payouts with Stripe, add at least one lesson, add a teaching location, and set your availability/);
  assert.match(COACH_TEXT, /Accepting charges the student’s card/);
  assert.match(COACH_TEXT, /paid through Stripe after the lesson/);
  assert.match(COACH_TEXT, /Inside 24 hours, both sides must agree to a weather cancellation/);
  assert.doesNotMatch(COACH_TEXT, /sick|emergenc/i);
});
