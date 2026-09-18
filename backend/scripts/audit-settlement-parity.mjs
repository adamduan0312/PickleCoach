/**
 * Live DB settlement parity audit for resolved disputes.
 *
 * Discovers disputes with status=resolved (or rejected), loads:
 *   - payment by booking_id (booking-detail path)
 *   - payment by payments.dispute_id (legacy association)
 * Compares settlement-critical fields and reports mismatches.
 *
 * Does not mutate data. Development only.
 *
 *   cd backend && NODE_ENV=development node scripts/audit-settlement-parity.mjs
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { sequelize, Dispute, Payment, Booking } from '../models/index.js';
import {
  diffSettlementPaymentFields,
  expectedSettlementCentsFromPayment,
} from '../utils/settlementQaFixtures.js';
import { dollarsToCents } from '../services/paymentEngine.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

sequelize.options.logging = false;

async function main() {
  const disputes = await Dispute.findAll({
    where: { status: { [Op.in]: ['resolved', 'rejected'] } },
    attributes: [
      'id',
      'booking_id',
      'status',
      'decision',
      'outcome',
      'penalize_role',
      'refund_cents',
      'resolution_action_id',
    ],
    include: [{ model: Booking, as: 'booking', attributes: ['id', 'status', 'payout_status', 'price'] }],
    order: [['id', 'DESC']],
    limit: 200,
  });

  const report = {
    ok: true,
    scanned: disputes.length,
    missing_dispute_id_link: [],
    payment_field_mismatches: [],
    /** Stale stored coach/fee after refunds — UI derives from retained; reseeding recommended. */
    stale_stored_allocation: [],
    inventory: [],
  };

  for (const dispute of disputes) {
    const bookingPayment = await Payment.findOne({
      where: { booking_id: dispute.booking_id },
      order: [['id', 'DESC']],
    });
    const linkedPayment = await Payment.findOne({
      where: { dispute_id: dispute.id },
      order: [['id', 'DESC']],
    });

    report.inventory.push({
      booking_id: dispute.booking_id,
      dispute_id: dispute.id,
      booking_status: dispute.booking?.status ?? null,
      decision: dispute.decision,
      outcome: dispute.outcome,
      refund_cents: dispute.refund_cents,
      payments_dispute_id_set: Boolean(linkedPayment),
      booking_payment_id: bookingPayment?.id ?? null,
      linked_payment_id: linkedPayment?.id ?? null,
    });

    if (!linkedPayment) {
      report.missing_dispute_id_link.push({
        booking_id: dispute.booking_id,
        dispute_id: dispute.id,
        note: 'GET /disputes/:id loads booking payment; link still recommended for association parity',
      });
    }

    if (bookingPayment && linkedPayment && bookingPayment.id !== linkedPayment.id) {
      const mismatches = diffSettlementPaymentFields(
        bookingPayment.toJSON(),
        linkedPayment.toJSON(),
        { label: '' },
      );
      if (mismatches.length) {
        report.payment_field_mismatches.push({
          booking_id: dispute.booking_id,
          dispute_id: dispute.id,
          mismatches,
        });
      }
    }

    if (bookingPayment) {
      const expected = expectedSettlementCentsFromPayment(bookingPayment.toJSON());
      const coachStored = dollarsToCents(bookingPayment.coach_payout_expected);
      const feeStored = dollarsToCents(bookingPayment.platform_fee_amount);
      const refunded = dollarsToCents(bookingPayment.refunded_amount ?? 0);
      if (refunded > 0) {
        if (coachStored !== expected.coachPayoutCents || feeStored !== expected.platformFeeCents) {
          report.stale_stored_allocation.push({
            booking_id: dispute.booking_id,
            dispute_id: dispute.id,
            stored: { coach: coachStored, platform: feeStored },
            expected: {
              coach: expected.coachPayoutCents,
              platform: expected.platformFeeCents,
              retained: expected.retainedCents,
            },
            note: 'UI derives coach/platform from retained; re-run seed:resolved-issues-qa to refresh rows',
          });
        }
      }
    }
  }

  // Hard fail only when two different payment rows disagree on money fields.
  report.ok = report.payment_field_mismatches.length === 0;

  console.log(JSON.stringify(report, null, 2));
  await sequelize.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
