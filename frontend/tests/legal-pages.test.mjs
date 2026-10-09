import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const legalSrc = read('../src/pages/LegalPages.jsx') + read('../src/domain/legal.js');

test('terms and privacy are public routes', () => {
  const app = read('../src/App.jsx');
  assert.match(app, /<Route path=\{TERMS_PATH\} element=\{<TermsPage \/>\} \/>/);
  assert.match(app, /<Route path=\{PRIVACY_PATH\} element=\{<PrivacyPage \/>\} \/>/);
  assert.ok(app.indexOf('<TermsPage />') < app.indexOf('<ShellLayout />'), 'readable without signing in');
  assert.match(legalSrc, /export const TERMS_PATH = '\/terms';/);
  assert.match(legalSrc, /export const PRIVACY_PATH = '\/privacy';/);
});

test('linked from registration, public footer, account menu, checkout and messages', () => {
  assert.match(read('../src/pages/auth/RegisterPage.jsx'), /18 or older and agree to the\{' '\}\s*<Link to=\{TERMS_PATH\}>Terms of Service<\/Link> and <Link to=\{PRIVACY_PATH\}>Privacy Policy<\/Link>/);
  for (const path of ['../src/components/layout/PublicFooter.jsx', '../src/components/layout/AppShell.jsx', '../src/pages/messages/MessagesPages.jsx']) {
    const src = read(path);
    assert.match(src, /to=\{TERMS_PATH\}/, path);
    assert.match(src, /to=\{PRIVACY_PATH\}/, path);
  }
  assert.match(read('../src/components/bookings/CheckoutPolicyExplainer.jsx'), /\{STAY_ON_PLATFORM_BODY\} See the <Link to=\{TERMS_PATH\}>Terms of Service<\/Link>/);
});

test('describes actual practices: review on occasion, not constant monitoring', () => {
  assert.match(legalSrc, /Messages may be reviewed for safety, fraud prevention, and policy enforcement/);
  assert.match(legalSrc, /We don’t continuously\s+monitor every message/);
  assert.doesNotMatch(legalSrc, /messages (are|will be) monitored/i);
  assert.match(legalSrc, /can’t guarantee that every breach will be detected/);
  assert.doesNotMatch(legalSrc, /twilio|\bSMS\b|text message/i, 'SMS isn’t sent today');
  assert.match(legalSrc, /at least 18 years old/);
  assert.match(legalSrc, /We don’t sell your personal information/);
});

test('account closure: Settings card on the existing endpoint, described in both policies', () => {
  const card = read('../src/components/settings/CloseAccountCard.jsx');
  assert.match(read('../src/api/index.js'), /closeAccount: \(\) => apiRequest\('\/auth\/me', \{ method: 'DELETE' \}\)/);
  assert.match(read('../src/pages/settings/SettingsPage.jsx'), /<CloseAccountCard \/>/);
  assert.ok(card.indexOf('confirming ?') > -1 && card.indexOf('Yes, close my account') > card.indexOf('confirming ?'), 'two-step, inline');
  assert.match(card, /await authApi\.closeAccount\(\);\s*await logout\(\);/);
  assert.match(card, /records are kept/);
  assert.match(legalSrc, /close your account in Settings once no lessons, issue reports, or payouts are still in progress/);
  assert.doesNotMatch(legalSrc, /to close your account,\s*contact/i);
});

test('business details live in one place until filled in', () => {
  const placeholders = legalSrc.match(/\[[A-Z ]+\]/g) || [];
  assert.deepEqual(
    [...new Set(placeholders)].sort(),
    ['[COMPANY LEGAL NAME]', '[CONTACT EMAIL]', '[EFFECTIVE DATE]'],
  );
  for (const p of placeholders) assert.equal(legalSrc.split(p).length - 1, 1, `${p} only in LEGAL_DETAILS`);
  assert.match(legalSrc, /governingLaw: 'the State of Florida, USA'/);
});
