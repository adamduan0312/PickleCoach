/**
 * Reconcile seed data when a booking has accumulated more than one dispute row
 * (e.g. earlier runs of `seed-more-disputes.js` happily picked the same booking
 * after a prior dispute had been resolved or rejected, producing two open
 * disputes on the same booking with contradictory types).
 *
 * What this script does (in development only):
 *   1) For every `bookings.id` that has 2+ dispute rows, keep exactly one
 *      according to this priority:
 *         a. an `open`/`under_review` row (the active dispute — the app's
 *            invariant says there can be at most one of these per booking),
 *         b. otherwise the most recently opened row (latest `opened_at`).
 *      All other dispute rows for that booking are deleted, along with any
 *      `payment_actions` rows linked to the deleted disputes (FK safety).
 *
 *   2) Reconcile `bookings.status` against the surviving dispute, so the
 *      booking row and disputes row stop disagreeing:
 *         - Active attendance dispute -> booking goes to `disputed`
 *           (unless it's already `student_no_show` / `coach_no_show` from a
 *           prior resolution — those are terminal and we don't roll back).
 *         - Resolved attendance dispute with `outcome` set -> booking goes
 *           to the matching `student_no_show` / `coach_no_show`.
 *         - Resolved/rejected behavior dispute on a `disputed` booking ->
 *           booking returns to `completed`.
 *
 *   3) Recompute `user_reliability` for every (coach_id, primary_student_id)
 *      pair touched, so the score reflects the cleaned-up dataset.
 *
 * Usage:
 *   node scripts/dedupe-seeded-disputes.js              # dry run
 *   node scripts/dedupe-seeded-disputes.js --apply      # actually mutate
 */

import dotenv from 'dotenv';
import { Op } from 'sequelize';
import {
  sequelize,
  Booking,
  Dispute,
  DisputeType,
  PaymentAction,
} from '../models/index.js';
import { updateUserReliability } from '../services/reliabilityService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const ACTIVE_STATUSES = new Set(['open', 'under_review']);
const ATTENDANCE_TYPE_CODES = new Set(['coach_no_show_claim', 'student_no_show_claim']);
const BEHAVIOR_TYPE_CODES = new Set(['misconduct', 'lesson_not_completed']);

/** Sort key: prefer active disputes, then the most recently opened. */
function disputeRank(d) {
  return [
    ACTIVE_STATUSES.has(d.status) ? 0 : 1,
    -(new Date(d.opened_at).getTime() || 0),
  ];
}

function compareRanks(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

async function loadDisputeTypeMap() {
  const rows = await DisputeType.findAll({ attributes: ['id', 'code'] });
  return Object.fromEntries(rows.map((r) => [r.id, r.code]));
}

/**
 * Decide what `bookings.status` should be given the surviving dispute and the
 * booking's current state. Returns `null` when no change is needed.
 */
function reconciledBookingStatus(currentStatus, survivor, typeCodeById) {
  const typeCode = typeCodeById[survivor.dispute_type_id];
  const isAttendance = ATTENDANCE_TYPE_CODES.has(typeCode);
  const isBehavior = BEHAVIOR_TYPE_CODES.has(typeCode);
  const active = ACTIVE_STATUSES.has(survivor.status);

  if (active) {
    // Don't roll terminal attendance outcomes back into `disputed` — those
    // were finalized by a prior admin decision and the active dispute we kept
    // is most likely the older one. Leave the booking row alone.
    if (currentStatus === 'student_no_show' || currentStatus === 'coach_no_show') {
      return null;
    }
    if (currentStatus !== 'disputed') return 'disputed';
    return null;
  }

  // Dispute is resolved / rejected.
  if (isAttendance && survivor.outcome) {
    if (survivor.outcome === 'student_no_show' && currentStatus !== 'student_no_show') {
      return 'student_no_show';
    }
    if (survivor.outcome === 'coach_no_show' && currentStatus !== 'coach_no_show') {
      return 'coach_no_show';
    }
    return null;
  }
  if (isBehavior && currentStatus === 'disputed') return 'completed';
  return null;
}

async function main() {
  try {
    await sequelize.authenticate();

    const typeCodeById = await loadDisputeTypeMap();

    const disputes = await Dispute.findAll({
      attributes: [
        'id',
        'booking_id',
        'dispute_type_id',
        'status',
        'opened_at',
        'outcome',
        'decision',
      ],
      order: [['booking_id', 'ASC'], ['opened_at', 'ASC']],
    });

    const byBooking = new Map();
    for (const d of disputes) {
      const list = byBooking.get(d.booking_id) || [];
      list.push(d);
      byBooking.set(d.booking_id, list);
    }

    const duplicates = [...byBooking.entries()].filter(([, list]) => list.length > 1);

    const plan = [];
    const reliabilityPairs = new Map();
    const bookingIdsTouched = new Set();
    const disputeIdsToDelete = [];

    for (const [bookingId, list] of duplicates) {
      const ranked = [...list].sort((a, b) => compareRanks(disputeRank(a), disputeRank(b)));
      const survivor = ranked[0];
      const losers = ranked.slice(1);

      const booking = await Booking.findByPk(bookingId, {
        attributes: ['id', 'status', 'coach_id', 'primary_student_id'],
      });
      if (!booking) continue;

      const newStatus = reconciledBookingStatus(booking.status, survivor, typeCodeById);

      plan.push({
        booking_id: bookingId,
        booking_status_before: booking.status,
        booking_status_after: newStatus ?? booking.status,
        survivor_dispute: {
          id: survivor.id,
          type_code: typeCodeById[survivor.dispute_type_id],
          status: survivor.status,
          decision: survivor.decision,
          outcome: survivor.outcome,
          opened_at: survivor.opened_at,
        },
        deleted_disputes: losers.map((d) => ({
          id: d.id,
          type_code: typeCodeById[d.dispute_type_id],
          status: d.status,
          opened_at: d.opened_at,
        })),
      });

      disputeIdsToDelete.push(...losers.map((d) => d.id));
      bookingIdsTouched.add(bookingId);
      if (booking.coach_id) {
        reliabilityPairs.set(`coach:${booking.coach_id}`, {
          user_id: booking.coach_id,
          role: 'coach',
        });
      }
      if (booking.primary_student_id) {
        reliabilityPairs.set(`student:${booking.primary_student_id}`, {
          user_id: booking.primary_student_id,
          role: 'student',
        });
      }
    }

    // Also reconcile any single-dispute bookings whose `bookings.status` is
    // already out of sync (e.g. booking `student_no_show` + open
    // `coach_no_show_claim` from earlier seed runs). Cheap pass over the
    // disputes set we already loaded.
    for (const [bookingId, list] of byBooking) {
      if (list.length > 1) continue; // handled above
      const survivor = list[0];
      const booking = await Booking.findByPk(bookingId, {
        attributes: ['id', 'status', 'coach_id', 'primary_student_id'],
      });
      if (!booking) continue;
      const newStatus = reconciledBookingStatus(booking.status, survivor, typeCodeById);
      if (newStatus == null) continue;

      plan.push({
        booking_id: bookingId,
        booking_status_before: booking.status,
        booking_status_after: newStatus,
        survivor_dispute: {
          id: survivor.id,
          type_code: typeCodeById[survivor.dispute_type_id],
          status: survivor.status,
          decision: survivor.decision,
          outcome: survivor.outcome,
          opened_at: survivor.opened_at,
        },
        deleted_disputes: [],
      });
      bookingIdsTouched.add(bookingId);
      if (booking.coach_id) {
        reliabilityPairs.set(`coach:${booking.coach_id}`, {
          user_id: booking.coach_id,
          role: 'coach',
        });
      }
      if (booking.primary_student_id) {
        reliabilityPairs.set(`student:${booking.primary_student_id}`, {
          user_id: booking.primary_student_id,
          role: 'student',
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          duplicate_bookings: duplicates.length,
          dispute_rows_to_delete: disputeIdsToDelete.length,
          booking_status_changes: plan.filter(
            (p) => p.booking_status_before !== p.booking_status_after,
          ).length,
          plan,
        },
        null,
        2,
      ),
    );

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to mutate the database.');
      process.exit(0);
    }

    await sequelize.transaction(async (t) => {
      if (disputeIdsToDelete.length) {
        // PaymentAction has a nullable FK to disputes; null it out before
        // deleting so we don't dangle. (Don't delete the payment_action — it
        // may have a successful Stripe refund attached.)
        await PaymentAction.update(
          { dispute_id: null },
          { where: { dispute_id: { [Op.in]: disputeIdsToDelete } }, transaction: t },
        );
        await Dispute.destroy({
          where: { id: { [Op.in]: disputeIdsToDelete } },
          transaction: t,
        });
      }

      for (const entry of plan) {
        if (entry.booking_status_before === entry.booking_status_after) continue;
        const messagingLocked =
          entry.booking_status_after === 'completed' ? false : true;
        await Booking.update(
          {
            status: entry.booking_status_after,
            messaging_locked: messagingLocked,
          },
          { where: { id: entry.booking_id }, transaction: t },
        );
      }
    });

    for (const { user_id, role } of reliabilityPairs.values()) {
      await updateUserReliability(user_id, role).catch((err) => {
        console.error(
          `Failed to recompute reliability for ${role} ${user_id}:`,
          err.message,
        );
      });
    }

    console.log(
      `\nApplied. Deleted ${disputeIdsToDelete.length} dispute rows, ` +
        `touched ${bookingIdsTouched.size} bookings, ` +
        `recomputed reliability for ${reliabilityPairs.size} (user, role) pairs.`,
    );
    process.exit(0);
  } catch (error) {
    console.error('dedupe-seeded-disputes failed:', error.message);
    if (error?.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main();
