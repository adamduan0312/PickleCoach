/**
 * Dev helper: simulate Stripe payment_intent.succeeded after coach accept.
 *
 * Coach accept sets payment to pending_capture; production confirms the booking
 * on webhook. This script completes that step for dev-seed PaymentIntents.
 *
 * Usage:
 *   npm run dev:simulate-capture -- --booking-id=123
 *   node scripts/simulate-coach-accept-capture.js 123
 */
import dotenv from 'dotenv';
import { sequelize, Booking, Payment } from '../models/index.js';
import * as paymentService from '../services/paymentService.js';
import { isDevSeedPaymentIntentId } from '../services/stripeService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

function parseBookingId(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--booking-id=')) return Number.parseInt(arg.split('=')[1], 10);
    const n = Number.parseInt(arg, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function main() {
  const bookingId = parseBookingId(process.argv.slice(2));
  if (!bookingId) {
    console.error('Usage: npm run dev:simulate-capture -- --booking-id=<id>');
    process.exit(1);
  }

  await sequelize.authenticate();

  const booking = await Booking.findByPk(bookingId);
  if (!booking) {
    console.error(`Booking ${bookingId} not found`);
    process.exit(1);
  }

  const payment = await Payment.findOne({
    where: { booking_id: bookingId },
    order: [['id', 'DESC']],
  });
  if (!payment?.payment_intent_id) {
    console.error(`Booking ${bookingId} has no payment_intent_id. Use seed:booking-action-tests.`);
    process.exit(1);
  }

  if (!isDevSeedPaymentIntentId(payment.payment_intent_id)) {
    console.error(
      `PaymentIntent ${payment.payment_intent_id} is not a dev seed stub. ` +
        'Use real Stripe webhooks or seed:booking-action-tests.',
    );
    process.exit(1);
  }

  if (!['pending_capture', 'authorized'].includes(payment.payment_status)) {
    console.warn(
      `Payment status is ${payment.payment_status}; expected pending_capture after accept or authorized before accept.`,
    );
  }

  const chargeId = `ch_seed_dev_${String(payment.payment_intent_id).slice(-12)}`;
  await paymentService.handlePaymentCapture(payment.payment_intent_id, chargeId);

  const updated = await Booking.findByPk(bookingId);
  console.log(
    JSON.stringify(
      {
        booking_id: updated.id,
        status: updated.status,
        messaging_locked: updated.messaging_locked,
        payment_status: (await Payment.findByPk(payment.id))?.payment_status,
        message:
          updated.status === 'confirmed'
            ? 'Capture simulated — messaging should be unlocked.'
            : 'Booking not confirmed; check payment/booking state.',
      },
      null,
      2,
    ),
  );
  process.exit(updated.status === 'confirmed' ? 0 : 1);
}

main().catch((err) => {
  console.error('Simulate capture failed:', err.message);
  process.exit(1);
});
