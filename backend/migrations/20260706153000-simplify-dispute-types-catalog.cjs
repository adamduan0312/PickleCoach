'use strict';

/**
 * Product simplification: five active dispute types.
 *   coach_no_show_claim, student_no_show_claim, misconduct, lesson_not_completed, other
 *
 * Removes: late_arrival → lesson_not_completed, refund_request / billing_issue → other.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    await q.transaction(async (transaction) => {
      const typeId = async (code) => {
        const [rows] = await q.query(`SELECT id FROM dispute_types WHERE code = :code LIMIT 1`, {
          replacements: { code },
          transaction,
        });
        return rows[0]?.id ?? null;
      };

      const lessonNotCompletedId = await typeId('lesson_not_completed');
      const otherId = await typeId('other');
      const lateArrivalId = await typeId('late_arrival');
      const refundRequestId = await typeId('refund_request');
      const billingIssueId = await typeId('billing_issue');

      if (lateArrivalId != null && lessonNotCompletedId != null) {
        await q.query(
          `UPDATE disputes SET dispute_type_id = :toId WHERE dispute_type_id = :fromId`,
          { replacements: { toId: lessonNotCompletedId, fromId: lateArrivalId }, transaction },
        );
      }

      for (const fromId of [refundRequestId, billingIssueId]) {
        if (fromId != null && otherId != null) {
          await q.query(`UPDATE disputes SET dispute_type_id = :toId WHERE dispute_type_id = :fromId`, {
            replacements: { toId: otherId, fromId },
            transaction,
          });
        }
      }

      for (const code of ['late_arrival', 'refund_request', 'billing_issue']) {
        await q.query(`DELETE FROM dispute_types WHERE code = :code`, {
          replacements: { code },
          transaction,
        });
      }

      if (otherId != null) {
        await q.query(
          `
          UPDATE dispute_types SET
            name = 'Other',
            description = 'Catch-all for issues not covered by attendance or behavior types (include refund requests in notes)',
            affects_reliability_score = 0
          WHERE id = :id
          `,
          { replacements: { id: otherId }, transaction },
        );
      }

      await q.query(
        `
        UPDATE dispute_types SET affects_reliability_score = 1
        WHERE code IN ('misconduct', 'lesson_not_completed')
        `,
        { transaction },
      );
    });
  },

  async down() {
    // Non-destructive: do not restore removed catalog rows.
  },
};
