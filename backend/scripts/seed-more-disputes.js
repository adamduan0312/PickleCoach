/**
 * Seed a couple more disputes for manual testing.
 *
 * Invariants this script enforces (so seeded data stays coherent):
 *   1) Each `disputes.booking_id` is unique in the seeded set: we never open
 *      a dispute on a booking that already has ANY dispute row (open,
 *      under_review, resolved, or rejected). That keeps the reliability
 *      service deterministic — `user_reliability` counts behavior penalties
 *      with a "latest per booking" dedupe, but mixing different dispute
 *      *types* on the same booking would still over-count signals.
 *   2) We only attach a fresh OPEN dispute to bookings whose status is
 *      logically compatible with a live dispute, i.e. the lesson is past
 *      auto-confirm but not in a terminal attendance/cancellation state.
 *      That means `awaiting_verification` or `completed` only — never
 *      `student_no_show` / `coach_no_show` / `cancelled` / `disputed`
 *      (already has an active dispute) / `pending` / `confirmed` (lesson
 *      hasn't happened).
 *   3) Each eligible booking gets a dispute type that matches its state:
 *      `awaiting_verification` rows lean toward attendance claims (the
 *      auto-confirm window is the natural surface for "I never saw them"),
 *      `completed` rows lean toward behavior disputes (the lesson happened,
 *      something went wrong during it).
 *
 * Usage:
 *   node scripts/seed-more-disputes.js
 *   node scripts/seed-more-disputes.js --count=2
 */
import dotenv from 'dotenv';
import {
  sequelize,
  Dispute,
  DisputeType,
  Booking,
} from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

const DEFAULT_COUNT = 2;

/** Booking statuses where opening a fresh OPEN dispute is logically valid. */
const DISPUTE_COMPATIBLE_BOOKING_STATUSES = ['awaiting_verification', 'completed'];

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

async function loadDisputeTypesByCode() {
  const rows = await DisputeType.findAll({ attributes: ['id', 'code'] });
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

/**
 * Map a booking's status to a dispute type that's plausible for that state.
 * Falls back to any available type if the preferred one is missing.
 */
function pickDisputeTypeForBooking(bookingStatus, typesByCode) {
  const attendancePool = ['coach_no_show_claim', 'student_no_show_claim'];
  const behaviorPool = ['misconduct', 'late_arrival', 'lesson_not_completed'];
  const preferred =
    bookingStatus === 'awaiting_verification' ? attendancePool : behaviorPool;

  for (const code of [...preferred, ...attendancePool, ...behaviorPool]) {
    const id = typesByCode[code];
    if (id != null) return { id, code };
  }
  return null;
}

/**
 * Return the most recent bookings that:
 *   - have both coach + student set,
 *   - are in a dispute-compatible status, and
 *   - have ZERO existing dispute rows (any status).
 *
 * The "any status" filter is the key fix vs. the previous version, which
 * only filtered out active disputes and therefore allowed seeded duplicates
 * once an earlier dispute had been resolved or rejected.
 */
async function pickEligibleBookings(limit) {
  const bookings = await Booking.findAll({
    where: {
      deleted_at: null,
      status: DISPUTE_COMPATIBLE_BOOKING_STATUSES,
    },
    attributes: ['id', 'primary_student_id', 'coach_id', 'status'],
    order: [['id', 'DESC']],
    limit: 200,
  });
  if (!bookings.length) return [];

  const existingDisputeBookingIds = new Set(
    (
      await Dispute.findAll({
        where: { booking_id: bookings.map((b) => b.id) },
        attributes: ['booking_id'],
      })
    ).map((d) => d.booking_id),
  );

  const eligible = [];
  for (const booking of bookings) {
    if (booking.primary_student_id == null || booking.coach_id == null) continue;
    if (existingDisputeBookingIds.has(booking.id)) continue;

    eligible.push(booking);
    if (eligible.length >= limit) break;
  }
  return eligible;
}

/** Choose `opened_by` such that the role is consistent with the dispute type. */
function pickOpenedByForType(typeCode, index) {
  if (typeCode === 'coach_no_show_claim') return 'student';
  if (typeCode === 'student_no_show_claim') return 'coach';
  return index % 2 === 0 ? 'student' : 'coach';
}

async function main() {
  const count = Math.max(1, parseIntArg('count', DEFAULT_COUNT));

  try {
    await sequelize.authenticate();

    const typesByCode = await loadDisputeTypesByCode();
    if (!Object.keys(typesByCode).length) {
      console.error('No dispute types found. Run migrations/seeds first.');
      process.exit(1);
    }

    const bookings = await pickEligibleBookings(count);
    if (!bookings.length) {
      console.error(
        'No eligible bookings found for seeding disputes. ' +
          `Need bookings in ${DISPUTE_COMPATIBLE_BOOKING_STATUSES.join(' or ')} ` +
          'with no existing dispute row.',
      );
      process.exit(1);
    }

    const created = [];
    for (let i = 0; i < bookings.length; i += 1) {
      const booking = bookings[i];
      const disputeType = pickDisputeTypeForBooking(booking.status, typesByCode);
      if (!disputeType) {
        console.error('No dispute type available to attach to booking', booking.id);
        continue;
      }

      const openedBy = pickOpenedByForType(disputeType.code, i);
      const dispute = await Dispute.create({
        booking_id: booking.id,
        dispute_type_id: disputeType.id,
        opened_by: openedBy,
        status: 'open',
      });
      created.push({
        dispute_id: dispute.id,
        booking_id: dispute.booking_id,
        booking_status: booking.status,
        dispute_type_id: dispute.dispute_type_id,
        dispute_type_code: disputeType.code,
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
