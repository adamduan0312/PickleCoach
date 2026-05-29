'use strict';

/**
 * Add `bookings.attendance_finalized` so dispute resolution becomes the final
 * authority for a booking's attendance outcome.
 *
 * Lifecycle contract going forward:
 *
 *   - Default `false` on every booking row. While `false`, the admin no-show
 *     endpoints (`POST /api/admin/bookings/:id/student-no-show` and
 *     `POST /api/admin/bookings/:id/coach-no-show`) may still flip the
 *     booking's attendance status (subject to their existing guards: active
 *     dispute blocks, lesson must have ended, etc.).
 *
 *   - `PUT /api/disputes/:id/resolve` is the ONLY writer that flips this flag
 *     to `true`. It does so for every resolved dispute — attendance claims
 *     (`coach_no_show_claim`, `student_no_show_claim`) AND behavior disputes
 *     (`misconduct`, `late_arrival`, `lesson_not_completed`). That is
 *     intentional: any dispute resolution is treated as the authoritative
 *     adjudication boundary for the booking incident, not only attendance
 *     claims. It does not imply the booking is deleted or invalidated;
 *     `lesson_not_completed` still represents a real booking row with a
 *     finalized adjudication result.
 *
 *   - Once `attendance_finalized = true`, the admin no-show endpoints return
 *     409 `attendance_finalized_locked`. The only path that can change the
 *     attendance outcome from that point is opening a NEW dispute on the
 *     same booking and resolving it; that resolve writes a fresh
 *     `disputes.outcome` and (re)affirms `attendance_finalized = true`.
 *
 *   - `disputes.outcome` remains the canonical historical record per dispute
 *     (immutable post-resolve); `bookings.status` is the current operational
 *     state; `bookings.attendance_finalized` is the guardrail keeping the
 *     two in lock-step after the first resolve.
 *
 * Backfill rule (matches the post-fix contract):
 *
 *   Set `attendance_finalized = true` only when the booking is currently in
 *   a terminal attendance/completed status AND has at least one dispute row
 *   with `resolved_at IS NOT NULL`. That correctly:
 *     - Leaves admin-set `student_no_show` / `coach_no_show` bookings (no
 *       dispute ever attached) still mutable via the admin endpoints — they
 *       were never adjudicated by a dispute and the admin's word stands.
 *     - Locks down bookings that were finalized via the dispute path.
 *     - Locks `completed` bookings only if they passed through dispute
 *       resolution (e.g. a resolved behavior dispute).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('bookings', { transaction });

      if (!table.attendance_finalized) {
        await queryInterface.addColumn(
          'bookings',
          'attendance_finalized',
          {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            after: 'payout_status',
          },
          { transaction },
        );
      }

      // Backfill: any booking currently in a terminal attendance/completed
      // state that has at least one resolved dispute is locked. We use INNER
      // JOIN so bookings with no dispute row stay `false` (admin-set
      // no-shows remain mutable until a future dispute resolves on them).
      await queryInterface.sequelize.query(
        `
          UPDATE bookings b
          INNER JOIN disputes d ON d.booking_id = b.id
          SET b.attendance_finalized = true
          WHERE b.status IN ('student_no_show', 'coach_no_show', 'completed')
            AND d.resolved_at IS NOT NULL
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('bookings', { transaction });
      if (table.attendance_finalized) {
        await queryInterface.removeColumn('bookings', 'attendance_finalized', { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
