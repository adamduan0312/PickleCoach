/**
 * Seed a couple more disputes for manual testing.
 *
 * Usage:
 *   node scripts/seed-more-disputes.js
 *   node scripts/seed-more-disputes.js --count=2
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  Dispute,
  DisputeType,
  Booking,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const DEFAULT_COUNT = 2;

const getArg = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
};

const parseIntArg = (name, fallback) => {
  const raw = getArg(name);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
};

async function pickDisputeTypeIds() {
  const types = await DisputeType.findAll({
    attributes: ['id'],
    order: [['id', 'ASC']],
  });
  if (!types.length) return [];
  return types.map((t) => t.id);
}

async function pickEligibleBookings(limit) {
  const bookings = await Booking.findAll({
    where: { deleted_at: null },
    attributes: ['id', 'primary_student_id', 'coach_id'],
    order: [['id', 'DESC']],
    limit: 200,
  });

  const eligible = [];
  for (const booking of bookings) {
    if (booking.primary_student_id == null || booking.coach_id == null) continue;

    const activeDispute = await Dispute.findOne({
      where: {
        booking_id: booking.id,
        status: { [Op.in]: ['open', 'under_review'] },
      },
      attributes: ['id'],
    });
    if (activeDispute) continue;

    eligible.push(booking);
    if (eligible.length >= limit) break;
  }
  return eligible;
}

async function main() {
  const count = Math.max(1, parseIntArg('count', DEFAULT_COUNT));

  try {
    await sequelize.authenticate();

    const disputeTypeIds = await pickDisputeTypeIds();
    if (!disputeTypeIds.length) {
      console.error('No dispute types found. Run migrations/seeds first.');
      process.exit(1);
    }

    const bookings = await pickEligibleBookings(count);
    if (!bookings.length) {
      console.error('No eligible bookings found for seeding disputes.');
      process.exit(1);
    }

    const created = [];
    for (let i = 0; i < bookings.length; i += 1) {
      const booking = bookings[i];
      const disputeTypeId = disputeTypeIds[i % disputeTypeIds.length];

      const openedBy = i % 2 === 0 ? 'student' : 'coach';
      const dispute = await Dispute.create({
        booking_id: booking.id,
        dispute_type_id: disputeTypeId,
        opened_by: openedBy,
        status: 'open',
      });
      created.push({
        dispute_id: dispute.id,
        booking_id: dispute.booking_id,
        dispute_type_id: dispute.dispute_type_id,
        opened_by: dispute.opened_by,
        status: dispute.status,
      });
    }

    console.log('Created disputes:');
    console.log(JSON.stringify(created, null, 2));
    console.log(`\nDone. Created ${created.length} dispute(s).`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed disputes:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
