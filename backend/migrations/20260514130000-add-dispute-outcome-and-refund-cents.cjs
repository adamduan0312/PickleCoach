'use strict';

/**
 * Persist resolution `outcome` and `refund_cents` on the `disputes` row.
 *
 * Before this migration:
 *   - The factual attendance result decided by an admin at resolve time was
 *     only stored on `bookings.status`. A later admin override of the booking
 *     would overwrite that determination, leaving no trace of what *this*
 *     dispute concluded.
 *   - The dollar amount of a partial refund was only stored on the linked
 *     `payment_actions.refund_cents` row. Common admin reads of a dispute
 *     could not surface the refund amount without an extra join.
 *
 * After this migration the dispute row is self-describing:
 *   - `outcome` ENUM('coach_no_show', 'student_no_show') NULL:
 *       For attendance disputes, the factual determination written at resolve
 *       time. Independent of `bookings.status` going forward.
 *   - `refund_cents` INT NULL:
 *       Integer cents (matches `payment_actions.refund_cents`). Populated at
 *       resolve time for `refund_student_partial`. Left NULL for
 *       `refund_student` (full) because the amount is computed by the
 *       payment-action worker from the remaining Stripe charge balance, and
 *       for `no_change`. Callers that need the executed full-refund amount
 *       continue to read it from the linked `payment_actions` row after the
 *       worker hydrates it.
 *
 * Backfill:
 *   - `outcome` is filled from `bookings.status` only when the booking still
 *     reflects an attendance result. If the booking has since moved elsewhere
 *     (e.g. another admin override flipped it back to `completed`), the
 *     historical outcome is unrecoverable and we leave NULL rather than guess.
 *   - `refund_cents` is filled from the linked `payment_actions` row whenever
 *     a numeric cents amount is available there. That covers all completed
 *     partial refunds and any full refund whose worker already snapped the
 *     amount from Stripe. Pending full refunds (cents still NULL on the
 *     payment_actions row) remain NULL here and will not be retro-filled.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('disputes', { transaction });

      if (!table.outcome) {
        await queryInterface.addColumn(
          'disputes',
          'outcome',
          {
            type: Sequelize.ENUM('coach_no_show', 'student_no_show'),
            allowNull: true,
            after: 'decision',
          },
          { transaction },
        );
      }

      if (!table.refund_cents) {
        await queryInterface.addColumn(
          'disputes',
          'refund_cents',
          {
            type: Sequelize.INTEGER,
            allowNull: true,
            after: 'outcome',
          },
          { transaction },
        );
      }

      // Backfill attendance outcome from booking status. We only trust the
      // booking row when it actually reflects an attendance result; anything
      // else (completed, cancelled, ...) is treated as unknown.
      await queryInterface.sequelize.query(
        `
          UPDATE disputes d
          INNER JOIN dispute_types dt ON dt.id = d.dispute_type_id
          INNER JOIN bookings b ON b.id = d.booking_id
          SET d.outcome = b.status
          WHERE d.outcome IS NULL
            AND d.status = 'resolved'
            AND dt.code IN ('coach_no_show_claim', 'student_no_show_claim')
            AND b.status IN ('coach_no_show', 'student_no_show')
        `,
        { transaction },
      );

      // Backfill refund_cents from the linked payment_actions row. Joining on
      // payment_actions.dispute_id (FK) is the canonical link. Multiple
      // payment_actions per dispute is not expected in practice (the resolve
      // path enqueues at most one), but if it occurs we deterministically
      // pick the most recent succeeded/pending row with a numeric cents value.
      await queryInterface.sequelize.query(
        `
          UPDATE disputes d
          INNER JOIN (
            SELECT pa1.dispute_id, pa1.refund_cents
            FROM payment_actions pa1
            INNER JOIN (
              SELECT dispute_id, MAX(id) AS max_id
              FROM payment_actions
              WHERE dispute_id IS NOT NULL
                AND refund_cents IS NOT NULL
                AND action_type IN ('dispute_refund_full', 'dispute_refund_partial')
              GROUP BY dispute_id
            ) pick ON pick.dispute_id = pa1.dispute_id AND pick.max_id = pa1.id
          ) pa ON pa.dispute_id = d.id
          SET d.refund_cents = pa.refund_cents
          WHERE d.refund_cents IS NULL
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
      const table = await queryInterface.describeTable('disputes', { transaction });

      if (table.refund_cents) {
        await queryInterface.removeColumn('disputes', 'refund_cents', { transaction });
      }

      if (table.outcome) {
        await queryInterface.removeColumn('disputes', 'outcome', { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
