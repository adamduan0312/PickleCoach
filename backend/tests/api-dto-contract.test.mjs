import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeBookingSummary,
  serializeBookingDetailCore,
  serializeBookingListItem,
  serializeBookingDetailPayload,
  serializeBookingResponse,
  serializeUserPartySummary,
  resolveStudentReliabilityScore,
} from '../utils/bookingDto.js';
import { serializePaymentSummary, serializePaymentListItem } from '../utils/paymentDto.js';
import { redactNotificationPayload, serializeNotification } from '../utils/notificationDto.js';
import { serializeCoachPublicUser, serializeCoachListItem, serializeStudentReliabilityDetail } from '../utils/userDto.js';

const fullBooking = {
  id: 352,
  lesson_id: 61,
  coach_id: 77,
  primary_student_id: 2,
  scheduled_at: '2026-06-01T10:00:00.000Z',
  duration_minutes: 60,
  price: '80.00',
  status: 'disputed',
  court_location_id: 75,
  messaging_locked: true,
  payout_status: 'none',
  attendance_finalized: false,
  cancelled_by: null,
  idempotency_key: 'idem-xyz',
  deleted_at: null,
  created_at: '2026-05-28T08:00:00.000Z',
  updated_at: '2026-05-28T08:00:00.000Z',
};

test('serializeBookingSummary trims persistence internals', () => {
  const dto = serializeBookingSummary(fullBooking);
  assert.equal(dto.id, 352);
  assert.equal(dto.messaging_locked, true);
  assert.equal(dto.idempotency_key, undefined);
  assert.equal(dto.payout_status, undefined);
  assert.ok(dto.financial_review);
  assert.equal(typeof dto.financial_review.review_until, 'string');
  assert.equal(typeof dto.financial_review.window_open, 'boolean');
});

test('serializeBookingDetailCore includes lifecycle fields', () => {
  const dto = serializeBookingDetailCore(fullBooking);
  assert.equal(dto.attendance_finalized, false);
  assert.equal(dto.payout_status, 'none');
  assert.equal(dto.idempotency_key, undefined);
  assert.equal(dto.coach_acceptance_timeout_hours, undefined);
});

test('serializeBookingDetailCore exposes coach acceptance timeout for pending bookings', () => {
  const dto = serializeBookingDetailCore({
    ...fullBooking,
    status: 'pending',
    created_at: '2026-08-26T14:00:00.000Z',
    scheduled_at: '2026-08-27T14:00:00.000Z',
  });
  assert.equal(dto.coach_acceptance_timeout_hours, 24);
  assert.equal(dto.min_booking_lead_hours, 2);
  // earlier of request+24h and lesson−2h → lesson−2h
  assert.equal(dto.coach_acceptance_deadline_at, '2026-08-27T12:00:00.000Z');
});

test('serializeBookingListItem exposes acceptance deadline for pending rows', () => {
  const dto = serializeBookingListItem({
    ...fullBooking,
    status: 'pending',
    created_at: '2026-08-26T14:00:00.000Z',
    scheduled_at: '2026-08-27T14:00:00.000Z',
  });
  assert.equal(dto.coach_acceptance_deadline_at, '2026-08-27T12:00:00.000Z');
  assert.equal(dto.min_booking_lead_hours, 2);
});

test('serializeBookingListItem trims nested associations', () => {
  const dto = serializeBookingListItem({
    ...fullBooking,
    lesson: { id: 1, title: 'Basics', deleted_at: 'x' },
    coach: { id: 77, full_name: 'Coach', avatar_url: '/a.png', email: 'c@x.com' },
    courtLocation: {
      id: 75,
      name: 'Court',
      address_line1: '1 Main',
      city: 'Miami',
      state: 'FL',
      postal_code: '33101',
      country: 'US',
      latitude: 1,
      longitude: 2,
      is_private: false,
    },
    conversation: { id: 9, can_send_messages: false, message_count: 2 },
  });
  assert.equal(dto.lesson.title, 'Basics');
  assert.equal(dto.lesson.deleted_at, undefined);
  assert.equal(dto.coach.email, undefined);
  assert.equal(dto.conversation.message_count, 2);
});

test('resolveStudentReliabilityScore defaults to 100 when missing', () => {
  assert.equal(resolveStudentReliabilityScore(null), 100);
  assert.equal(resolveStudentReliabilityScore({ id: 2, full_name: 'Stu' }), 100);
  assert.equal(resolveStudentReliabilityScore({ id: 2, reliabilities: [] }), 100);
});

test('resolveStudentReliabilityScore reads student reliability row only', () => {
  assert.equal(
    resolveStudentReliabilityScore({
      id: 2,
      reliabilities: [
        { role: 'coach', reliability_score: 50 },
        { role: 'student', reliability_score: 96.5 },
      ],
    }),
    96.5,
  );
});

test('opt-in includeStudentReliability attaches score only (unused by coach booking routes)', () => {
  const dto = serializeBookingListItem(
    {
      ...fullBooking,
      primaryStudent: {
        id: 2,
        full_name: 'John Doe',
        avatar_url: null,
        email: 'stu@example.com',
        reliabilities: [
          {
            role: 'student',
            reliability_score: 96,
            late_cancels_recent: 3,
            decay_lambda: 0.03,
          },
        ],
      },
    },
    { includeStudentReliability: true },
  );
  assert.equal(dto.primaryStudent.id, 2);
  assert.equal(dto.primaryStudent.full_name, 'John Doe');
  assert.equal(dto.primaryStudent.reliability_score, 96);
  assert.equal(dto.primaryStudent.email, undefined);
  assert.equal(dto.primaryStudent.reliabilities, undefined);
  assert.equal(dto.primaryStudent.late_cancels_recent, undefined);
  assert.equal(dto.primaryStudent.decay_lambda, undefined);
});

test('opt-in includeStudentReliability defaults reliability_score to 100 when no row', () => {
  const dto = serializeBookingListItem(
    {
      ...fullBooking,
      primaryStudent: { id: 2, full_name: 'John Doe', avatar_url: null },
    },
    { includeStudentReliability: true },
  );
  assert.equal(dto.primaryStudent.reliability_score, 100);
});

test('default booking serializers omit student reliability even if loaded (MVP coach contract)', () => {
  const studentWithRel = {
    id: 2,
    full_name: 'John Doe',
    avatar_url: null,
    reliabilities: [{ role: 'student', reliability_score: 88, no_shows_recent: 2 }],
  };
  const listDto = serializeBookingListItem({
    ...fullBooking,
    primaryStudent: studentWithRel,
  });
  assert.equal(listDto.primaryStudent.reliability_score, undefined);
  assert.equal(listDto.primaryStudent.reliabilities, undefined);

  const detailDto = serializeBookingDetailPayload({
    ...fullBooking,
    primaryStudent: studentWithRel,
  });
  assert.equal(detailDto.primaryStudent.reliability_score, undefined);

  const party = serializeUserPartySummary(studentWithRel);
  assert.equal(party.reliability_score, undefined);

  const coachPublic = serializeCoachPublicUser({
    id: 77,
    full_name: 'Coach',
    avatar_url: null,
    timezone: 'UTC',
    coachProfile: { headline: 'Pro' },
    reliabilities: [{ role: 'coach', reliability_score: 90 }],
  });
  assert.equal(coachPublic.reliability.reliability_score, 90);
  assert.equal(coachPublic.primaryStudent, undefined);
  assert.equal(coachPublic.reliability_student, undefined);
});

test('serializeBookingDetailPayload omits players (MVP: no group lessons)', () => {
  const dto = serializeBookingDetailPayload({
    ...fullBooking,
    players: [
      {
        booking_id: 352,
        player_id: 99,
        player: { id: 99, full_name: 'Extra', email: 'x@y.com' },
      },
    ],
    lesson: { id: 1, title: 'Basics' },
  });
  assert.equal(dto.players, undefined);
  assert.equal(dto.lesson.title, 'Basics');
  assert.equal(dto.primary_student_id, 2);
});

test('serializeBookingDetailPayload attaches student reliability only when opted in', () => {
  const dto = serializeBookingDetailPayload(
    {
      ...fullBooking,
      primaryStudent: {
        id: 2,
        full_name: 'Stu',
        reliabilities: [{ role: 'student', reliability_score: 91 }],
      },
    },
    { includeStudentReliability: true },
  );
  assert.equal(dto.primaryStudent.reliability_score, 91);
});

test('serializeBookingDetailPayload uses payment serializer', () => {
  const dto = serializeBookingDetailPayload(
    {
      ...fullBooking,
      payments: [
        {
          id: 1,
          booking_id: 352,
          payment_intent_id: 'pi_secret',
          payment_status: 'captured',
          total_charge_to_student: '80.00',
          escrow_status: 'held',
          refund_status: 'none',
        },
      ],
    },
    { serializePayment: (p) => serializePaymentSummary(p, { isAdmin: false }) },
  );
  assert.equal(dto.payments[0].payment_status, 'captured');
  assert.equal(dto.payments[0].payment_intent_id, undefined);
});

test('serializePaymentSummary hides Stripe fields for participants', () => {
  const dto = serializePaymentSummary(
    {
      id: 1,
      booking_id: 2,
      payment_status: 'captured',
      payment_intent_id: 'pi_123',
      metadata: { foo: 'bar' },
      total_charge_to_student: '50.00',
      escrow_status: 'held',
      refund_status: 'none',
    },
    { isAdmin: false },
  );
  assert.equal(dto.payment_intent_id, undefined);
  assert.equal(dto.metadata, undefined);
});

test('serializePaymentSummary exposes Stripe fields for admin', () => {
  const dto = serializePaymentSummary(
    { id: 1, payment_intent_id: 'pi_123', payment_status: 'captured' },
    { isAdmin: true },
  );
  assert.equal(dto.payment_intent_id, 'pi_123');
});

test('serializePaymentListItem embeds trimmed booking', () => {
  const dto = serializePaymentListItem({
    id: 1,
    booking_id: 352,
    payment_status: 'captured',
    total_charge_to_student: '80.00',
    escrow_status: 'held',
    refund_status: 'none',
    booking: fullBooking,
    coach: { id: 77, full_name: 'Coach' },
    student: { id: 2, full_name: 'Student' },
  });
  assert.equal(dto.booking.id, 352);
  assert.equal(dto.booking.idempotency_key, undefined);
});

test('redactNotificationPayload strips sensitive keys', () => {
  const out = redactNotificationPayload({
    booking_id: 1,
    coach_name: 'Coach',
    reset_token: 'secret',
    verify_url: 'https://example.com/verify?token=abc',
  });
  assert.equal(out.booking_id, 1);
  assert.equal(out.reset_token, undefined);
  assert.equal(out.verify_url, undefined);
});

test('serializeNotification redacts payload', () => {
  const out = serializeNotification({
    id: 1,
    user_id: 2,
    type: 'password_reset',
    channel: 'email',
    payload: { reset_token: 'x', headline: 'Reset' },
    status: 'sent',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(out.payload.reset_token, undefined);
  assert.equal(out.payload.headline, 'Reset');
});

test('serializeNotification adds payload.route for deep links', () => {
  const out = serializeNotification({
    id: 3,
    user_id: 2,
    type: 'new_message',
    channel: 'in_app',
    payload: { conversation_id: 42, headline: 'New message', summary: 'John: Sounds good!' },
    status: 'sent',
  });
  assert.equal(out.payload.route, '/messages/42');
});

test('serializeCoachPublicUser maps lessons through public marketplace DTO', () => {
  const out = serializeCoachPublicUser({
    id: 37,
    full_name: 'Coach Bob',
    avatar_url: null,
    timezone: 'UTC',
    coachProfile: { headline: 'Pro' },
    reliabilities: [{ role: 'coach', reliability_score: 90 }],
    lessons: [
      {
        id: 29,
        coach_id: 37,
        title: 'Beginner',
        description: 'Basics',
        duration_minutes: 60,
        price: '60.00',
        effective_hourly_rate: 60,
        max_students: 1,
        is_active: true,
        deleted_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        coach: { id: 37, full_name: 'Coach Bob' },
      },
    ],
  });
  assert.equal(out.lessons.length, 1);
  assert.equal(out.lessons[0].id, 29);
  assert.equal(out.lessons[0].price, '60.00');
  assert.equal(out.lessons[0].is_active, undefined);
  assert.equal(out.lessons[0].deleted_at, undefined);
  assert.equal(out.lessons[0].created_at, undefined);
  assert.equal(out.lessons[0].coach, undefined);
});

test('serializeCoachListItem flattens profile, renames courts, drops join IDs', () => {
  const out = serializeCoachListItem({
    id: 37,
    full_name: 'Geo Coach',
    email: 'secret@example.com',
    avatar_url: null,
    timezone: 'America/Los_Angeles',
    coachProfile: {
      id: 9,
      user_id: 37,
      headline: 'SF coach',
      bio: 'Bio',
      experience_years: 7,
      skill_rating: 4.0,
      rating_system: 'self',
      certifications: null,
      location: 'SF',
      rating_average: 4.9,
      rating_count: 10,
      stripe_account_id: 'acct_x',
      coach_commission_percent: 92,
    },
    reliabilities: [],
    coachCourts: [
      {
        id: 100,
        coach_id: 37,
        court_id: 58,
        court: {
          id: 58,
          name: 'Mission Courts',
          address_line1: '1 Mission',
          city: 'San Francisco',
          state: 'CA',
          postal_code: '94103',
          country: 'US',
          latitude: 37.7599,
          longitude: -122.425,
          is_private: false,
          deleted_at: null,
        },
      },
    ],
  });
  assert.equal(out.email, undefined);
  assert.equal(out.coachProfile, undefined);
  assert.equal(out.coachCourts, undefined);
  assert.equal(out.headline, 'SF coach');
  assert.equal(out.skill_rating, 4.0);
  assert.equal(out.rating_average, 4.9);
  assert.equal(out.reliability_score, 100);
  assert.equal(out.courts.length, 1);
  assert.equal(out.courts[0].name, 'Mission Courts');
  assert.equal(out.courts[0].id, undefined);
  assert.equal(out.courts[0].address_line1, '1 Mission');
  assert.equal(out.courts[0].city, 'San Francisco');
  assert.equal(out.courts[0].area, 'San Francisco, CA 94103');
  assert.equal(out.distance_miles, undefined);
});

test('serializeCoachListItem adds distance_miles for geo search', () => {
  const out = serializeCoachListItem(
    {
      id: 37,
      full_name: 'Geo Coach',
      timezone: 'UTC',
      coachProfile: { headline: 'Near', skill_rating: 4, rating_average: 5, rating_count: 1 },
      reliabilities: [{ role: 'coach', reliability_score: 88 }],
      coachCourts: [
        {
          court: {
            name: 'Near Court',
            address_line1: '1 Near St',
            city: 'San Francisco',
            state: 'CA',
            postal_code: '94103',
            country: 'US',
            latitude: 37.78,
            longitude: -122.41,
            is_private: false,
          },
        },
      ],
    },
    { searchLat: 37.78, searchLng: -122.41 },
  );
  assert.equal(out.reliability_score, 88);
  assert.equal(out.distance_miles, 0);
  assert.equal(out.courts[0].distance_miles, 0);
});

test('serializeStudentReliabilityDetail mirrors coach style without engine internals', () => {
  const out = serializeStudentReliabilityDetail({
    reliability_score: 88.5,
    score_source: 'computed',
    total_bookings: 12,
    late_cancels: 1,
    no_shows: 0,
    misconduct_penalties: 0,
    lesson_not_completed_penalties: 0,
    coach_cancels: 2,
    student_cancels_non_late: 3,
    last_updated: '2026-01-01T00:00:00.000Z',
    smoothing_k: 5,
    decay_lambda: 0.1,
  });
  assert.equal(out.reliability_score, 88.5);
  assert.equal(out.total_bookings, 12);
  assert.equal(out.smoothing_k, undefined);
});

test('serializeBookingResponse preserves mutation extras', () => {
  const out = serializeBookingResponse(
    { ...fullBooking, lesson: { id: 61, title: 'L', duration_minutes: 60, price: '80', coach_id: 77, is_active: true } },
    { attendance_outcome: 'student_no_show', no_show_party: 'student' },
  );
  assert.equal(out.attendance_outcome, 'student_no_show');
  assert.equal(out.idempotency_key, undefined);
});

test('serializeBookingResponse can include student reliability for coach viewers', () => {
  const out = serializeBookingResponse(
    {
      ...fullBooking,
      primaryStudent: {
        id: 2,
        full_name: 'Stu',
        reliabilities: [{ role: 'student', reliability_score: 77 }],
      },
    },
    { attendance_outcome: 'student_no_show' },
    { includeStudentReliability: true },
  );
  assert.equal(out.primaryStudent.reliability_score, 77);
  assert.equal(out.attendance_outcome, 'student_no_show');
});
