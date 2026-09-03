/**
 * Notification idempotency / race: duplicate event delivery, concurrent notify*,
 * and retry after a failed email send must yield one logical in-app + email pair.
 *
 * Run from backend/:
 *   npm run test:integration
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const RUN = process.env.RUN_HTTP_INTEGRATION === '1';

import { sequelize, Booking, Notification } from '../../models/index.js';
import { createBookingJourneyFixture } from '../helpers/integrationFixture.mjs';
import {
  notifyBookingAccepted,
  notifyCoachNewBookingRequest,
  notifyNewMessage,
  sendNotification,
  sendReminderNotification,
} from '../../services/notificationService.js';

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

async function ensureLogicalNotificationUniqueIndex() {
  try {
    await sequelize.query(`
      ALTER TABLE notifications
      ADD UNIQUE INDEX notifications_logical_event_unique
      (user_id, type, channel, entity_type, entity_id)
    `);
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/Duplicate key name|ER_DUP_KEYNAME/i.test(msg)) throw err;
  }
}

async function seedBooking(fixture, status = 'confirmed') {
  return Booking.create({
    lesson_id: fixture.lesson.id,
    coach_id: fixture.coach.id,
    primary_student_id: fixture.student.id,
    scheduled_at: fixture.scheduledAt,
    duration_minutes: fixture.lesson.duration_minutes || 60,
    price: fixture.lesson.price,
    status,
    court_location_id: fixture.court.id,
    idempotency_key: `notif_idemp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
  });
}

async function rowsFor({ userId, type, bookingId }) {
  return Notification.findAll({
    where: { user_id: userId, type },
    order: [['id', 'ASC']],
  }).then((rows) =>
    rows.filter((n) => {
      const payloadBookingId = n.payload?.booking_id ?? n.entity_id;
      return bookingId == null || Number(payloadBookingId) === Number(bookingId);
    }),
  );
}

function countByChannel(rows) {
  return {
    in_app: rows.filter((r) => r.channel === 'in_app').length,
    email: rows.filter((r) => r.channel === 'email').length,
  };
}

describeHttp('HTTP integration: notification idempotency and races', () => {
  let fixture = null;

  before(async () => {
    await ensureLogicalNotificationUniqueIndex();
    fixture = await createBookingJourneyFixture();
  });

  after(async () => {
    if (fixture?.cleanup) await fixture.cleanup();
  });

  it('duplicate notifyCoachNewBookingRequest is one in-app + one email', async () => {
    const booking = await seedBooking(fixture, 'pending');

    await notifyCoachNewBookingRequest(booking.id);
    await notifyCoachNewBookingRequest(booking.id);

    const rows = await rowsFor({
      userId: fixture.coach.id,
      type: 'booking_request_coach',
      bookingId: booking.id,
    });
    const counts = countByChannel(rows);
    assert.equal(counts.in_app, 1);
    assert.equal(counts.email, 1);
    assert.equal(rows.find((r) => r.channel === 'in_app').status, 'sent');
    assert.equal(rows.find((r) => r.channel === 'email').entity_id, booking.id);
  });

  it('concurrent notifyBookingAccepted creates one logical pair', async () => {
    const booking = await seedBooking(fixture, 'confirmed');

    await Promise.all([
      notifyBookingAccepted(booking.id),
      notifyBookingAccepted(booking.id),
      notifyBookingAccepted(booking.id),
    ]);

    const rows = await rowsFor({
      userId: fixture.student.id,
      type: 'booking_confirmed',
      bookingId: booking.id,
    });
    const counts = countByChannel(rows);
    assert.equal(counts.in_app, 1);
    assert.equal(counts.email, 1);
    assert.equal(rows.find((r) => r.channel === 'in_app').status, 'sent');
    assert.equal(rows.find((r) => r.channel === 'email').entity_type, 'booking');
  });

  it('retry after failed email send does not create a second email row', async () => {
    const booking = await seedBooking(fixture, 'pending');

    await notifyCoachNewBookingRequest(booking.id);
    const first = await rowsFor({
      userId: fixture.coach.id,
      type: 'booking_request_coach',
      bookingId: booking.id,
    });
    const email = first.find((r) => r.channel === 'email');
    assert.ok(email);

    // Simulate provider failure after the row exists (retry must reuse it).
    await email.update({ status: 'failed', sent_at: null });

    await sendNotification(email.id);
    await notifyCoachNewBookingRequest(booking.id);

    const again = await rowsFor({
      userId: fixture.coach.id,
      type: 'booking_request_coach',
      bookingId: booking.id,
    });
    const counts = countByChannel(again);
    assert.equal(counts.in_app, 1);
    assert.equal(counts.email, 1);
    assert.equal(again.find((r) => r.channel === 'email').id, email.id);
  });

  it('concurrent 24h reminders stay one logical pair per audience with matching email', async () => {
    const booking = await seedBooking(fixture, 'confirmed');
    const loaded = await Booking.findByPk(booking.id, {
      include: [
        { association: 'coach' },
        { association: 'primaryStudent' },
        { association: 'lesson' },
        { association: 'courtLocation' },
      ],
    });

    await Promise.all([
      sendReminderNotification(loaded, '24h'),
      sendReminderNotification(loaded, '24h'),
    ]);

    for (const { userId, audience } of [
      { userId: fixture.student.id, audience: 'student' },
      { userId: fixture.coach.id, audience: 'coach' },
    ]) {
      const rows = await rowsFor({
        userId,
        type: 'pre_lesson_24h',
        bookingId: booking.id,
      });
      const counts = countByChannel(rows);
      assert.equal(counts.in_app, 1, `${audience} in-app`);
      assert.equal(counts.email, 1, `${audience} email`);
      assert.equal(rows.find((r) => r.channel === 'in_app').status, 'sent');
    }
  });

  it('duplicate new_message for the same message id is a single in-app row', async () => {
    const booking = await seedBooking(fixture, 'confirmed');
    const message = { id: 9_000_000 + booking.id, body: 'See you there' };
    const args = {
      booking,
      message,
      sender: fixture.student,
      conversationId: 1,
    };

    await Promise.all([notifyNewMessage(args), notifyNewMessage(args)]);

    const rows = await Notification.findAll({
      where: {
        user_id: fixture.coach.id,
        type: 'new_message',
        entity_type: 'message',
        entity_id: message.id,
      },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].channel, 'in_app');
    assert.equal(rows[0].status, 'sent');
  });
});

if (!RUN) {
  describe('HTTP integration notification idempotency (gated)', () => {
    it('skipped — set RUN_HTTP_INTEGRATION=1 (npm run test:integration)', () => {
      assert.ok(true);
    });
  });
}
