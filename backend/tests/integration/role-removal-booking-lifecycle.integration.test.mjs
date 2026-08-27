/**
 * HTTP integration: self-service role removal must not break existing bookings,
 * must hide the coach from Discover, and must restore the same CoachProfile on re-add.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, CoachProfile, Lesson, UserRole } from '../../models/index.js';
import * as stripeService from '../../services/stripeService.js';
import { createInMemoryPaymentIntentDouble } from '../helpers/inMemoryPaymentIntentDouble.mjs';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import { startTestServer, api } from '../helpers/httpApp.mjs';

let dbOk = false;
if (RUN) {
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch (e) {
    console.warn('[http-integration] DB unavailable:', e.message);
  }
}

const describeHttp = RUN && dbOk ? describe : describe.skip;

async function login(baseUrl, email, password) {
  const res = await api(baseUrl, 'POST', '/api/auth/login', {
    body: { email, password },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.data.token;
}

async function createPendingBooking(baseUrl, { studentToken, lessonId, courtId, scheduledAt, key }) {
  const intentRes = await api(baseUrl, 'POST', '/api/booking-intents', {
    token: studentToken,
    body: {
      lesson_id: lessonId,
      scheduled_at: scheduledAt.toISOString(),
      court_location_id: courtId,
      payment_method: 'stripe',
      idempotency_key: key,
    },
  });
  assert.equal(intentRes.status, 201, intentRes.text);
  const confirmRes = await api(baseUrl, 'POST', '/api/bookings/confirm', {
    token: studentToken,
    body: { payment_intent_id: intentRes.json.data.payment_intent_id },
  });
  assert.ok([200, 201].includes(confirmRes.status), confirmRes.text);
  const bookingId = confirmRes.json?.data?.booking?.id;
  assert.ok(bookingId, confirmRes.text);
  return bookingId;
}

describeHttp('HTTP integration: role removal preserves booking lifecycle', () => {
  let server = null;
  let fixture = null;
  let stripeDouble = null;

  before(async () => {
    stripeDouble = createInMemoryPaymentIntentDouble();
    stripeService.setStripeTestDouble(stripeDouble);
    server = await startTestServer();
  });

  after(async () => {
    stripeService.clearStripeTestDouble();
    try {
      if (fixture?.cleanup) await fixture.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it('coach removes coach role: disappears from Discover; pending booking still accept/cancel-able', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;

    // Coach must keep a marketplace role after remove → give them student too.
    await UserRole.findOrCreate({
      where: { user_id: fixture.coach.id, role: 'student' },
      defaults: { user_id: fixture.coach.id, role: 'student' },
    });

    const studentToken = await login(baseUrl, fixture.student.email, fixture.password);
    let coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

    const bookingId = await createPendingBooking(baseUrl, {
      studentToken,
      lessonId: fixture.lesson.id,
      courtId: fixture.court.id,
      scheduledAt: fixture.scheduledAt,
      key: `role_rm_coach_${Date.now()}`,
    });

    const beforeBooking = await Booking.findByPk(bookingId);
    assert.equal(beforeBooking.status, 'pending');
    assert.equal(beforeBooking.coach_id, fixture.coach.id);

    const profileBefore = await CoachProfile.findOne({ where: { user_id: fixture.coach.id } });
    assert.ok(profileBefore);
    const profileId = profileBefore.id;
    const lessonId = fixture.lesson.id;

    // Public coach page visible while role present
    const publicBefore = await api(baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, {
      token: studentToken,
    });
    assert.equal(publicBefore.status, 200, publicBefore.text);

    const removeRes = await api(baseUrl, 'PUT', '/api/auth/me/role', {
      token: coachToken,
      body: { role: 'coach', action: 'remove' },
    });
    assert.equal(removeRes.status, 200, removeRes.text);
    assert.ok(removeRes.json.data?.token, removeRes.text);
    coachToken = removeRes.json.data.token;
    const roles = removeRes.json.data.user.roles || [];
    assert.ok(roles.includes('student'));
    assert.ok(!roles.includes('coach'));

    // Disappears from Discover / public coach lookup
    const publicAfter = await api(baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, {
      token: studentToken,
    });
    assert.equal(publicAfter.status, 404, publicAfter.text);

    const listAfter = await api(
      baseUrl,
      'GET',
      `/api/coaches?lat=${fixture.court.latitude}&lng=${fixture.court.longitude}&radius=25`,
      { token: studentToken },
    );
    assert.equal(listAfter.status, 200, listAfter.text);
    const listed = Array.isArray(listAfter.json?.data) ? listAfter.json.data : [];
    assert.ok(!listed.some((c) => Number(c.id) === Number(fixture.coach.id)));

    // Historical profile + lessons retained
    const profileAfter = await CoachProfile.findOne({ where: { user_id: fixture.coach.id } });
    assert.ok(profileAfter);
    assert.equal(profileAfter.id, profileId);
    const lessonAfter = await Lesson.findByPk(lessonId);
    assert.ok(lessonAfter);
    assert.equal(lessonAfter.deleted_at ?? null, null);

    // Existing booking still accessible to coach (participant, not current role)
    const getAsCoach = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, {
      token: coachToken,
    });
    assert.equal(getAsCoach.status, 200, getAsCoach.text);
    assert.equal(getAsCoach.json.data.id, bookingId);

    // Accept still works for the assigned coach on the booking
    const acceptRes = await api(baseUrl, 'PUT', `/api/bookings/${bookingId}/accept`, {
      token: coachToken,
    });
    assert.equal(acceptRes.status, 200, acceptRes.text);
    const accepted = await Booking.findByPk(bookingId);
    assert.equal(accepted.status, 'confirmed');

    // Re-add coach → same profile/lessons still present
    const readdRes = await api(baseUrl, 'PUT', '/api/auth/me/role', {
      token: coachToken,
      body: { role: 'coach', action: 'add' },
    });
    assert.equal(readdRes.status, 200, readdRes.text);
    coachToken = readdRes.json.data.token;
    assert.ok((readdRes.json.data.user.roles || []).includes('coach'));

    const profileRestored = await CoachProfile.findOne({ where: { user_id: fixture.coach.id } });
    assert.equal(profileRestored.id, profileId);
    const lessonRestored = await Lesson.findByPk(lessonId);
    assert.equal(lessonRestored.id, lessonId);

    const publicAgain = await api(baseUrl, 'GET', `/api/coaches/${fixture.coach.id}`, {
      token: studentToken,
    });
    assert.equal(publicAgain.status, 200, publicAgain.text);
  });

  it('student removes student role: cannot create new booking; existing booking remains usable', async () => {
    if (fixture?.cleanup) await fixture.cleanup();
    fixture = await createBookingJourneyFixture();
    const { baseUrl } = server;
    let extraStudentCoachProfileId = null;

    try {
      // Student needs another marketplace role to remove student.
      await UserRole.findOrCreate({
        where: { user_id: fixture.student.id, role: 'coach' },
        defaults: { user_id: fixture.student.id, role: 'coach' },
      });
      const [studentCoachProfile] = await CoachProfile.findOrCreate({
        where: { user_id: fixture.student.id },
        defaults: {
          user_id: fixture.student.id,
          headline: 'Student dual-role',
          bio: 'For role-remove test',
          experience_years: 1,
          skill_rating: 3,
          rating_system: 'self',
          location: 'Brooklyn, NY',
          stripe_ready: false,
        },
      });
      extraStudentCoachProfileId = studentCoachProfile.id;

      let studentToken = await login(baseUrl, fixture.student.email, fixture.password);
      const coachToken = await login(baseUrl, fixture.coach.email, fixture.password);

      const bookingId = await createPendingBooking(baseUrl, {
        studentToken,
        lessonId: fixture.lesson.id,
        courtId: fixture.court.id,
        scheduledAt: fixture.scheduledAt,
        key: `role_rm_student_${Date.now()}`,
      });

      const removeRes = await api(baseUrl, 'PUT', '/api/auth/me/role', {
        token: studentToken,
        body: { role: 'student', action: 'remove' },
      });
      assert.equal(removeRes.status, 200, removeRes.text);
      studentToken = removeRes.json.data.token;
      assert.ok(!(removeRes.json.data.user.roles || []).includes('student'));
      assert.ok((removeRes.json.data.user.roles || []).includes('coach'));

      // New booking intents require current student role
      const newIntent = await api(baseUrl, 'POST', '/api/booking-intents', {
        token: studentToken,
        body: {
          lesson_id: fixture.lesson.id,
          scheduled_at: new Date(fixture.scheduledAt.getTime() + 7 * 86400000).toISOString(),
          court_location_id: fixture.court.id,
          payment_method: 'stripe',
          idempotency_key: `role_rm_student_new_${Date.now()}`,
        },
      });
      assert.equal(newIntent.status, 403, newIntent.text);

      // Existing booking still visible / cancellable as participant
      const getExisting = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, {
        token: studentToken,
      });
      assert.equal(getExisting.status, 200, getExisting.text);

      const cancelRes = await api(baseUrl, 'POST', `/api/bookings/${bookingId}/cancel`, {
        token: studentToken,
        body: { reason: 'schedule_conflict', reason_notes: 'Role-remove lifecycle test' },
      });
      assert.equal(cancelRes.status, 200, cancelRes.text);
      const cancelled = await Booking.findByPk(bookingId);
      assert.equal(cancelled.status, 'cancelled');

      // Coach side still sees the cancelled booking history
      const getAsCoach = await api(baseUrl, 'GET', `/api/bookings/${bookingId}`, {
        token: coachToken,
      });
      assert.equal(getAsCoach.status, 200, getAsCoach.text);
    } finally {
      if (extraStudentCoachProfileId) {
        await CoachProfile.destroy({ where: { id: extraStudentCoachProfileId } });
      }
    }
  });
});

if (!RUN) {
  describe('HTTP integration role-removal (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
