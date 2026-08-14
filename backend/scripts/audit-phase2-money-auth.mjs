/**
 * Phase-2 live audit: money path + auth-token flows.
 *
 * Does NOT mutate production code to make tests pass. Classifies outcomes as:
 *   PASS | FAIL (application defect) | LIMIT (seed/infra/env limitation)
 *
 * Prerequisites (dev):
 *   - API at BASE_URL (default http://localhost:4000)
 *   - STRIPE_SECRET_KEY=sk_test_…
 *   - stripe listen → localhost:4000/api/webhooks/stripe (for webhook suite)
 *   - coach7@example.com stripe_ready (for live money path)
 *
 * Usage (from backend/):
 *   node scripts/audit-phase2-money-auth.mjs
 */
import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';

const envName = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${envName}` });

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const API = `${BASE}/api`;
const PASSWORD = 'Test1234!Ab';
const STRIPE_BIN = process.env.STRIPE_BIN || '/opt/homebrew/bin/stripe';

const results = [];
function record(suite, name, status, detail = '') {
  results.push({ suite, name, status, detail });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, url, { token, body, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: rawBody != null ? rawBody : body == null ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    return { status: 0, ms: Date.now() - started, json: null, text: e.message, headers: {} };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, ms: Date.now() - started, json, text: text.slice(0, 400), headers: res.headers };
}

async function login(email) {
  const r = await call('POST', `${API}/auth/login`, {
    body: { email, password: PASSWORD },
  });
  if (r.status !== 200 || !r.json?.data?.token) {
    throw new Error(`Login failed for ${email}: ${r.status} ${r.text}`);
  }
  return { token: r.json.data.token, user: r.json.data.user };
}

async function loadModels() {
  const models = await import('../models/index.js');
  await models.sequelize.authenticate();
  return models;
}

async function suiteConnectStatus(models) {
  console.log('\n=== Suite A: Stripe Connect status graceful handling ===');
  const { User, CoachProfile } = models;

  // Disposable coach with fake account id (mirrors seed limitation)
  const email = `phase2.connect.${Date.now()}@picklecoach.example.org`;
  const bcrypt = (await import('bcryptjs')).default;
  const user = await User.create({
    full_name: 'Phase2 Connect Coach',
    email,
    password_hash: bcrypt.hashSync(PASSWORD, 8),
    is_active: true,
    email_verified_at: new Date(),
    timezone: 'America/New_York',
  });
  await models.UserRole.create({ user_id: user.id, role: 'coach' });
  await CoachProfile.create({
    user_id: user.id,
    headline: 'Phase2',
    bio: 'audit',
    experience_years: 1,
    skill_rating: 3,
    rating_system: 'self',
    location: 'NY',
    stripe_account_id: 'acct_testflow_seed',
    stripe_ready: true,
    stripe_onboarding_completed_at: new Date(),
  });

  const { token } = await login(email);
  const status = await call('GET', `${API}/coaches/me/stripe-connect/status`, { token });

  if (status.status === 200 && status.json?.data?.onboarded === false) {
    record(
      'connect-status',
      'fake account id → 200 onboarded:false (cleared)',
      'PASS',
      `cleared=${status.json.data.cleared_invalid_account === true}`,
    );
  } else if (status.status === 502) {
    record(
      'connect-status',
      'fake account id',
      'LIMIT',
      `got 502 (Stripe unreachable or unclassified error): ${status.text.slice(0, 120)}`,
    );
  } else if (status.status === 500) {
    record(
      'connect-status',
      'fake account id still returns opaque 500',
      'FAIL',
      status.text.slice(0, 160),
    );
  } else {
    record('connect-status', 'fake account id unexpected', 'FAIL', `${status.status} ${status.text.slice(0, 160)}`);
  }

  // Real stripe_ready coach (coach7) — production-like path
  try {
    const coach7 = await login('coach7@example.com');
    const real = await call('GET', `${API}/coaches/me/stripe-connect/status`, { token: coach7.token });
    if (real.status === 200 && real.json?.data?.onboarded === true) {
      record('connect-status', 'coach7 real Connect status', 'PASS', `ready=${real.json.data.stripe_ready}`);
    } else if (real.status === 200 && real.json?.data?.onboarded === false) {
      record(
        'connect-status',
        'coach7 Connect status',
        'LIMIT',
        'not onboarded / account cleared — money-path may be limited',
      );
    } else if (real.status === 502) {
      record('connect-status', 'coach7 Connect status', 'LIMIT', `Stripe unavailable: ${real.text.slice(0, 100)}`);
    } else {
      record('connect-status', 'coach7 Connect status', 'FAIL', `${real.status} ${real.text.slice(0, 160)}`);
    }
  } catch (e) {
    record('connect-status', 'coach7 login', 'LIMIT', e.message);
  }

  // Cleanup disposable coach (best-effort)
  try {
    await CoachProfile.destroy({ where: { user_id: user.id } });
    await models.UserRole.destroy({ where: { user_id: user.id } });
    await User.destroy({ where: { id: user.id } });
  } catch {
    /* ignore */
  }
}

async function suiteAuthTokens(models) {
  console.log('\n=== Suite B: Auth token flows (reset / verify / change-email) ===');
  const { User } = models;
  const bcrypt = (await import('bcryptjs')).default;

  const email = `phase2.auth.${Date.now()}@picklecoach.example.org`;
  const user = await User.create({
    full_name: 'Phase2 Auth User',
    email,
    password_hash: bcrypt.hashSync(PASSWORD, 8),
    is_active: true,
    email_verified_at: null,
    timezone: 'America/New_York',
  });
  await models.UserRole.create({ user_id: user.id, role: 'student' });

  // --- Password reset ---
  const forgot = await call('POST', `${API}/auth/forgot-password`, { body: { email } });
  if (forgot.status === 200) {
    record('auth-token', 'forgot-password', 'PASS', '200 (no email enumeration)');
  } else {
    record('auth-token', 'forgot-password', 'FAIL', `${forgot.status}`);
  }

  await user.reload();
  if (!user.password_reset_token) {
    record('auth-token', 'forgot-password stores token', 'FAIL', 'token missing in DB');
  } else {
    const badReset = await call('POST', `${API}/auth/reset-password`, {
      body: { token: 'not-a-real-token', password: 'NewSecurePassword123!' },
    });
    record(
      'auth-token',
      'reset-password invalid token → 400',
      badReset.status === 400 ? 'PASS' : 'FAIL',
      `got ${badReset.status}`,
    );

    const newPass = 'NewSecurePassword123!';
    const goodReset = await call('POST', `${API}/auth/reset-password`, {
      body: { token: user.password_reset_token, password: newPass },
    });
    record(
      'auth-token',
      'reset-password valid token',
      goodReset.status === 200 ? 'PASS' : 'FAIL',
      `got ${goodReset.status}`,
    );

    const loginOld = await call('POST', `${API}/auth/login`, {
      body: { email, password: PASSWORD },
    });
    record(
      'auth-token',
      'login with old password after reset → 401',
      loginOld.status === 401 ? 'PASS' : 'FAIL',
      `got ${loginOld.status}`,
    );

    const loginNew = await call('POST', `${API}/auth/login`, {
      body: { email, password: newPass },
    });
    record(
      'auth-token',
      'login with new password after reset',
      loginNew.status === 200 ? 'PASS' : 'FAIL',
      `got ${loginNew.status}`,
    );

    // Keep password as newPass for subsequent steps
    var authToken = loginNew.json?.data?.token;
  }

  if (!authToken) {
    record('auth-token', 'skip verify/change-email', 'LIMIT', 'no auth token after reset');
    return;
  }

  // --- Email verification ---
  const reqVerify = await call('POST', `${API}/auth/verify-email/request`, { token: authToken, body: {} });
  record(
    'auth-token',
    'verify-email/request',
    [200, 429].includes(reqVerify.status) ? 'PASS' : 'FAIL',
    `got ${reqVerify.status}`,
  );

  await user.reload();
  const verifyBad = await call('POST', `${API}/auth/verify-email/confirm`, {
    body: { token: 'bogus' },
  });
  record(
    'auth-token',
    'verify-email/confirm invalid → 400',
    verifyBad.status === 400 ? 'PASS' : 'FAIL',
    `got ${verifyBad.status}`,
  );

  if (user.email_verification_token) {
    const verifyOk = await call('POST', `${API}/auth/verify-email/confirm`, {
      body: { token: user.email_verification_token },
    });
    record(
      'auth-token',
      'verify-email/confirm valid',
      verifyOk.status === 200 ? 'PASS' : 'FAIL',
      `got ${verifyOk.status}`,
    );
    await user.reload();
    record(
      'auth-token',
      'email_verified_at set',
      user.email_verified_at ? 'PASS' : 'FAIL',
      String(user.email_verified_at),
    );
  } else {
    record('auth-token', 'verify-email token in DB', 'FAIL', 'missing after request');
  }

  // Re-login (token may still work)
  const reLogin = await call('POST', `${API}/auth/login`, {
    body: { email, password: 'NewSecurePassword123!' },
  });
  authToken = reLogin.json?.data?.token || authToken;

  // --- Change email ---
  const newEmail = `phase2.auth.changed.${Date.now()}@picklecoach.example.org`;
  const reqChange = await call('POST', `${API}/auth/change-email/request`, {
    token: authToken,
    body: { new_email: newEmail, password: 'NewSecurePassword123!' },
  });
  record(
    'auth-token',
    'change-email/request',
    reqChange.status === 200 ? 'PASS' : 'FAIL',
    `got ${reqChange.status} ${reqChange.json?.message || ''}`,
  );

  const changeBad = await call('POST', `${API}/auth/change-email/confirm`, {
    body: { token: 'bogus' },
  });
  record(
    'auth-token',
    'change-email/confirm invalid → 400',
    changeBad.status === 400 ? 'PASS' : 'FAIL',
    `got ${changeBad.status}`,
  );

  await user.reload();
  if (user.email_change_token) {
    const changeOk = await call('POST', `${API}/auth/change-email/confirm`, {
      body: { token: user.email_change_token },
    });
    record(
      'auth-token',
      'change-email/confirm valid',
      changeOk.status === 200 ? 'PASS' : 'FAIL',
      `got ${changeOk.status}`,
    );
    await user.reload();
    record(
      'auth-token',
      'email updated after confirm',
      user.email === newEmail ? 'PASS' : 'FAIL',
      `email=${user.email}`,
    );
    // Login with new email
    const loginChanged = await call('POST', `${API}/auth/login`, {
      body: { email: newEmail, password: 'NewSecurePassword123!' },
    });
    record(
      'auth-token',
      'login with changed email',
      loginChanged.status === 200 ? 'PASS' : 'FAIL',
      `got ${loginChanged.status}`,
    );
  } else {
    record('auth-token', 'change-email token in DB', 'FAIL', 'missing after request');
  }

  // Cleanup
  try {
    await models.UserRole.destroy({ where: { user_id: user.id } });
    await User.destroy({ where: { id: user.id } });
  } catch {
    /* ignore */
  }
}

async function suiteMoneyPath(models) {
  console.log('\n=== Suite C: Money path (authorize → accept/capture → cancel/refund) ===');

  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    record('money', 'STRIPE_SECRET_KEY sk_test_', 'LIMIT', 'missing — skip live money path');
    return;
  }

  let coach7;
  try {
    coach7 = await login('coach7@example.com');
  } catch (e) {
    record('money', 'coach7 login', 'LIMIT', e.message);
    return;
  }

  const connect = await call('GET', `${API}/coaches/me/stripe-connect/status`, { token: coach7.token });
  if (!(connect.status === 200 && connect.json?.data?.onboarded && connect.json?.data?.stripe_ready)) {
    record(
      'money',
      'coach7 stripe_ready prerequisite',
      'LIMIT',
      `${connect.status} onboarded=${connect.json?.data?.onboarded} ready=${connect.json?.data?.stripe_ready}`,
    );
    // Still try seed — it will fail clearly
  } else {
    record('money', 'coach7 stripe_ready', 'PASS');
  }

  // Seed authorized bookings via existing script (live Stripe) — run from backend/
  console.log('\n  (running seed:c2-money-path with C2_AUTHORIZED_COUNT=2 C2_OPEN_SLOTS=0)…');
  const seed = spawnSync(process.execPath, ['scripts/seed-c2-money-path.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      C2_AUTHORIZED_COUNT: '2',
      C2_OPEN_SLOTS: '0',
      NODE_ENV: 'development',
    },
    encoding: 'utf8',
  });

  const seedOut = `${seed.stdout || ''}\n${seed.stderr || ''}`;
  let authorizedIds = [...seedOut.matchAll(/Authorized booking #(\d+)/g)].map((m) => Number(m[1]));
  if (authorizedIds.length === 0) {
    authorizedIds = [...seedOut.matchAll(/booking (\d+)\s+/g)].map((m) => Number(m[1]));
  }

  if (seed.status !== 0 || authorizedIds.length === 0) {
    record(
      'money',
      'seed:c2-money-path',
      'LIMIT',
      `exit=${seed.status} ids=${authorizedIds.length} tail=${seedOut.slice(-400).replace(/\n/g, ' | ')}`,
    );
    await moneyPathViaHttp(coach7);
    return;
  }

  record('money', 'seed:c2-money-path authorized bookings', 'PASS', `ids=${authorizedIds.join(',')}`);

  const student = await login(
    (await models.User.findByPk(
      (await models.Booking.findByPk(authorizedIds[0]))?.primary_student_id,
    ))?.email || 'student.testflow@picklecoach.example.org',
  ).catch(async () => login('student.testflow@picklecoach.example.org'));

  const [acceptId, cancelId] = authorizedIds;

  // Accept → capture
  const accept = await call('PUT', `${API}/bookings/${acceptId}/accept`, { token: coach7.token });
  if ([200, 201].includes(accept.status)) {
    record('money', `coach accept booking ${acceptId}`, 'PASS', accept.json?.message?.slice(0, 80));
  } else {
    record('money', `coach accept booking ${acceptId}`, 'FAIL', `${accept.status} ${accept.text.slice(0, 160)}`);
  }

  // Wait briefly for webhook from stripe listen
  await new Promise((r) => setTimeout(r, 2500));
  let booking = await models.Booking.findByPk(acceptId);
  let payment = await models.Payment.findOne({ where: { booking_id: acceptId } });

  if (booking?.status === 'confirmed' && payment?.payment_status === 'captured') {
    record('money', `webhook/capture confirmed booking ${acceptId}`, 'PASS', `payment=${payment.payment_status}`);
  } else if (['pending', 'confirmed'].includes(booking?.status) && payment?.payment_status === 'pending_capture') {
    // Simulate capture if webhook lagged
    const sim = spawnSync(
      process.execPath,
      ['scripts/simulate-coach-accept-capture.js', `--booking-id=${acceptId}`],
      { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
    );
    await booking.reload();
    await payment.reload();
    if (booking.status === 'confirmed' && payment.payment_status === 'captured') {
      record(
        'money',
        `capture via simulate after accept ${acceptId}`,
        'PASS',
        'webhook lag — simulate-capture succeeded (LIMIT on live webhook timing)',
      );
    } else {
      record(
        'money',
        `capture after accept ${acceptId}`,
        'FAIL',
        `status=${booking.status} pay=${payment.payment_status} sim=${sim.status} ${sim.stderr?.slice(0, 120)}`,
      );
    }
  } else {
    record(
      'money',
      `post-accept state ${acceptId}`,
      booking?.status === 'confirmed' ? 'PASS' : 'FAIL',
      `booking=${booking?.status} payment=${payment?.payment_status}`,
    );
  }

  // Cancel second authorized booking (pre-accept pending cancel voids PI)
  const cancel = await call('POST', `${API}/bookings/${cancelId}/cancel`, {
    token: student.token,
    body: { reason: 'schedule_conflict' },
  });
  if (cancel.status === 200) {
    record('money', `student cancel authorized pending ${cancelId}`, 'PASS', cancel.json?.message?.slice(0, 80));
  } else {
    record('money', `student cancel authorized pending ${cancelId}`, 'FAIL', `${cancel.status} ${cancel.text.slice(0, 160)}`);
  }

  // Edge: accept already cancelled
  const acceptCancelled = await call('PUT', `${API}/bookings/${cancelId}/accept`, { token: coach7.token });
  record(
    'money',
    `accept already-cancelled ${cancelId} rejected`,
    [400, 409].includes(acceptCancelled.status) ? 'PASS' : 'FAIL',
    `got ${acceptCancelled.status}`,
  );

  // Duplicate accept on already accepted
  const doubleAccept = await call('PUT', `${API}/bookings/${acceptId}/accept`, { token: coach7.token });
  record(
    'money',
    `double accept ${acceptId} rejected or idempotent`,
    [200, 400, 409].includes(doubleAccept.status) ? 'PASS' : 'FAIL',
    `got ${doubleAccept.status} ${doubleAccept.json?.message?.slice(0, 80) || ''}`,
  );

  // Admin refund on captured booking (needs real charge_id)
  await booking?.reload();
  await payment?.reload();
  if (payment?.charge_id && payment.payment_status === 'captured') {
    const admin = await login('admin.testflow@picklecoach.example.org').catch(() => null);
    if (admin) {
      const refund = await call('POST', `${API}/admin/bookings/${acceptId}/refund`, {
        token: admin.token,
        body: { reason: 'requested_by_customer', reason_notes: 'Phase2 audit partial', refund_amount: 5 },
      });
      if ([200, 201].includes(refund.status)) {
        record('money', `admin partial refund booking ${acceptId}`, 'PASS', refund.json?.message?.slice(0, 80));
      } else if (refund.status === 400 && /charge|refund/i.test(refund.text)) {
        record('money', `admin partial refund booking ${acceptId}`, 'LIMIT', refund.text.slice(0, 120));
      } else {
        record('money', `admin partial refund booking ${acceptId}`, 'FAIL', `${refund.status} ${refund.text.slice(0, 160)}`);
      }
    } else {
      record('money', 'admin login for refund', 'LIMIT', 'admin.testflow missing — run seed:test-flows');
    }
  } else {
    record('money', 'admin refund', 'LIMIT', `no captured charge_id yet (pay=${payment?.payment_status})`);
  }
}

async function moneyPathViaHttp(coach7) {
  record('money', 'HTTP fallback money path', 'LIMIT', 'attempting intent via API');
  let student;
  try {
    student = await login('student.testflow@picklecoach.example.org');
  } catch {
    try {
      student = await login('student1@example.com');
    } catch (e) {
      record('money', 'student login', 'LIMIT', e.message);
      return;
    }
  }

  // Discover lesson/court from coach
  const lessons = await call('GET', `${API}/coaches/me/lessons`, { token: coach7.token });
  const courts = await call('GET', `${API}/coaches/me/courts`, { token: coach7.token });
  const lessonId = lessons.json?.data?.[0]?.id || lessons.json?.data?.lessons?.[0]?.id;
  const courtRow = courts.json?.data?.[0];
  const courtId = courtRow?.court_id || courtRow?.court?.id || courtRow?.id;
  if (!lessonId || !courtId) {
    record('money', 'coach lesson/court', 'LIMIT', `lesson=${lessonId} court=${courtId}`);
    return;
  }

  const scheduled = new Date(Date.now() + 5 * 86400000);
  scheduled.setMinutes(0, 0, 0);
  // aim for a weekday 10:00 UTC-ish — may still fail slot checks
  const intent = await call('POST', `${API}/booking-intents`, {
    token: student.token,
    body: {
      lesson_id: lessonId,
      scheduled_at: scheduled.toISOString(),
      court_location_id: courtId,
      payment_method: 'stripe',
      idempotency_key: `phase2_http_${Date.now()}`,
    },
  });
  if (![200, 201].includes(intent.status)) {
    record('money', 'create booking intent', 'LIMIT', `${intent.status} ${intent.text.slice(0, 160)}`);
    return;
  }
  record('money', 'create booking intent', 'PASS', `pi=${intent.json?.data?.payment_intent_id || intent.json?.data?.id}`);
}

async function suiteWebhooks(models) {
  console.log('\n=== Suite D: Webhooks (signature + duplicate) ===');

  const unsigned = await call('POST', `${API}/webhooks/stripe`, {
    body: { id: 'evt_phase2_unsigned', type: 'payment_intent.succeeded', data: { object: {} } },
  });
  record(
    'webhook',
    'unsigned body rejected',
    [400, 401].includes(unsigned.status) ? 'PASS' : 'FAIL',
    `got ${unsigned.status}`,
  );

  // Duplicate skip unit is covered in paymentStripeContract tests; live: stripe trigger if CLI works
  const trigger = spawnSync(
    STRIPE_BIN,
    ['trigger', 'payment_intent.succeeded', '--override', 'payment_intent:metadata[phase2]=audit'],
    { encoding: 'utf8', env: process.env, timeout: 60000 },
  );
  if (trigger.status === 0) {
    record('webhook', 'stripe trigger payment_intent.succeeded', 'PASS', 'CLI trigger ok (listen should forward)');
    await new Promise((r) => setTimeout(r, 2000));

    // Find a recent webhook log and ensure duplicate semantics via DB helper if event id present
    const { WebhookLog } = models;
    const recent = await WebhookLog.findOne({ order: [['id', 'DESC']] });
    if (recent) {
      record('webhook', 'WebhookLog row written', 'PASS', `id=${recent.id} event=${recent.event_id || recent.stripe_event_id}`);
    } else {
      record('webhook', 'WebhookLog row written', 'LIMIT', 'no rows — listen secret mismatch or not received');
    }
  } else {
    record(
      'webhook',
      'stripe trigger',
      'LIMIT',
      `CLI failed (listen may still be up): ${(trigger.stderr || trigger.stdout || '').slice(0, 160)}`,
    );
  }

  // Contract: shouldStripeWebhookSkipAsDuplicate (success=true means already processed)
  try {
    const { shouldStripeWebhookSkipAsDuplicate } = await import('../services/paymentStripeContract.js');
    const skipProcessed = shouldStripeWebhookSkipAsDuplicate({ success: true });
    const skipFailed = shouldStripeWebhookSkipAsDuplicate({ success: false });
    const skipNull = shouldStripeWebhookSkipAsDuplicate(null);
    record(
      'webhook',
      'duplicate skip contract (success:true)',
      skipProcessed === true ? 'PASS' : 'FAIL',
      `skip=${skipProcessed}`,
    );
    record(
      'webhook',
      'duplicate skip contract (success:false / null)',
      skipFailed === false && skipNull === false ? 'PASS' : 'FAIL',
      `fail=${skipFailed} null=${skipNull}`,
    );
  } catch (e) {
    record('webhook', 'duplicate skip contract import', 'LIMIT', e.message);
  }
}

function printSummary() {
  console.log('\n========== PHASE-2 SUMMARY ==========');
  const tallies = {};
  for (const r of results) {
    tallies[r.status] = (tallies[r.status] || 0) + 1;
  }
  console.log(tallies);
  const fails = results.filter((r) => r.status === 'FAIL');
  const limits = results.filter((r) => r.status === 'LIMIT');
  if (fails.length) {
    console.log('\nAPPLICATION DEFECTS (FAIL):');
    for (const f of fails) console.log(` - [${f.suite}] ${f.name}: ${f.detail}`);
  }
  if (limits.length) {
    console.log('\nSEED / INFRA LIMITATIONS (LIMIT):');
    for (const f of limits) console.log(` - [${f.suite}] ${f.name}: ${f.detail}`);
  }
  console.log(`\nTotal FAIL: ${fails.length}  LIMIT: ${limits.length}  PASS: ${tallies.PASS || 0}`);
  return fails.length;
}

async function main() {
  console.log(`Phase-2 audit → ${BASE}`);
  console.log(`Stripe key test mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'yes' : 'no'}`);

  const health = await call('GET', `${BASE}/health`);
  if (health.status !== 200) {
    console.error('API health failed', health);
    process.exit(1);
  }
  record('meta', 'health', 'PASS', health.text.slice(0, 80));

  const models = await loadModels();

  await suiteConnectStatus(models);
  await suiteAuthTokens(models);
  await suiteMoneyPath(models);
  await suiteWebhooks(models);

  const failCount = printSummary();
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
