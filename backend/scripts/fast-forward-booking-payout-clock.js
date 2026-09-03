/**
 * Dev helper: move a booking's scheduled_at so the lesson has already ended.
 *
 * Default mode (what you want for Complete QA):
 *   - Lesson end is a few minutes in the past
 *   - Status is left alone (still confirmed / awaiting_verification)
 *   - Coach must click Mark complete manually
 *   - The 24h financial-review / payout clock is NOT skipped
 *
 * Optional payout mode (after you've marked complete):
 *   --for-payout  → place lesson end ~25h ago so payoutWorker can release escrow
 *
 * Does NOT call Stripe, does NOT mark complete, does NOT create transfers.
 *
 * Usage (from backend/):
 *   node scripts/fast-forward-booking-payout-clock.js --booking-id=123 --confirm
 *   node scripts/fast-forward-booking-payout-clock.js --booking-id=123 --ended-minutes-ago=5 --confirm
 *   node scripts/fast-forward-booking-payout-clock.js --booking-id=123 --for-payout --confirm
 */
import dotenv from 'dotenv';
import { sequelize, Booking, Payment } from '../models/index.js';
import {
  getFinancialReviewUntil,
  getLessonEndAt,
  isPostLessonFinancialReviewElapsed,
} from '../utils/financialReviewWindow.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.error('Refusing to run without --confirm');
  console.error('Usage: node scripts/fast-forward-booking-payout-clock.js --booking-id=<id> --confirm');
  process.exit(1);
}

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const bookingId = Number(getArg('booking-id'));
const forPayout = process.argv.includes('--for-payout');
const endedMinutesAgo = Number(getArg('ended-minutes-ago') || 5);

if (!Number.isFinite(bookingId) || bookingId <= 0) {
  console.error('Required: --booking-id=<id>');
  process.exit(1);
}
if (!forPayout && (!Number.isFinite(endedMinutesAgo) || endedMinutesAgo < 1)) {
  console.error('--ended-minutes-ago must be >= 1');
  process.exit(1);
}

function snapshot(booking) {
  const reviewUntil = getFinancialReviewUntil(booking);
  return {
    status: booking.status,
    payout_status: booking.payout_status,
    scheduled_at: booking.scheduled_at,
    duration_minutes: booking.duration_minutes,
    lesson_end: getLessonEndAt(booking)?.toISOString() || null,
    review_until: reviewUntil?.toISOString() || null,
    lesson_ended: getLessonEndAt(booking) ? Date.now() >= getLessonEndAt(booking).getTime() : false,
    review_elapsed: isPostLessonFinancialReviewElapsed(booking),
    payments: (booking.payments || []).map((p) => ({
      id: p.id,
      payment_status: p.payment_status,
      escrow_status: p.escrow_status,
      transfer_id: p.transfer_id,
    })),
  };
}

async function main() {
  await sequelize.authenticate();
  const booking = await Booking.findByPk(bookingId, {
    include: [{ model: Payment, as: 'payments' }],
  });
  if (!booking) {
    console.error(`Booking ${bookingId} not found`);
    process.exit(1);
  }

  const duration = Number(booking.duration_minutes) || 60;
  const now = Date.now();

  let scheduledAt;
  if (forPayout) {
    // Lesson ended ~25h ago → review window already closed (for payoutWorker QA).
    const lessonEndTarget = now - 25 * 60 * 60 * 1000;
    scheduledAt = new Date(lessonEndTarget - duration * 60 * 1000);
  } else {
    // Lesson ended a few minutes ago → Mark complete available; payout still waits 24h.
    const lessonEndTarget = now - endedMinutesAgo * 60 * 1000;
    scheduledAt = new Date(lessonEndTarget - duration * 60 * 1000);
  }

  const before = snapshot(booking);
  await booking.update({ scheduled_at: scheduledAt });
  await booking.reload({ include: [{ model: Payment, as: 'payments' }] });
  const after = snapshot(booking);

  console.log(JSON.stringify({
    booking_id: bookingId,
    mode: forPayout ? 'for_payout' : 'end_lesson_only',
    before,
    after,
  }, null, 2));

  if (forPayout) {
    console.log('\n✅ Payout clock advanced (review window elapsed).');
    console.log('  Booking status was NOT changed — mark complete first if still confirmed.');
    console.log('  Then wait for payoutWorker (~10 min) with stripe listen running.');
  } else {
    console.log('\n✅ Lesson end moved into the past.');
    console.log('  Status unchanged — coach should Mark complete in the app.');
    console.log('  Payment to coach still waits until lesson end + 24h (use --for-payout after complete).');
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
}).finally(async () => {
  try { await sequelize.close(); } catch { /* ignore */ }
});
