'use strict';

/**
 * Postman and docs assume resolution_action_id 1 and dispute_type_id 1 exist.
 * Migrations previously created empty dispute_resolution_actions / dispute_types tables,
 * so resolving a dispute with FK resolution_action_id caused MySQL to reject the UPDATE.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [actionRows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS c FROM dispute_resolution_actions',
    );
    const actionCount = Number(actionRows[0]?.c ?? 0);
    if (actionCount === 0) {
      const now = new Date();
      await queryInterface.bulkInsert('dispute_resolution_actions', [
        {
          id: 1,
          code: 'approved_refund',
          name: 'Approved refund',
          description: 'Refund approved (e.g. service issue)',
          affects_reliability_score: true,
          requires_payout_adjustment: true,
          created_at: now,
        },
        {
          id: 2,
          code: 'no_action',
          name: 'No action',
          description: 'Dispute closed without payout change',
          affects_reliability_score: false,
          requires_payout_adjustment: false,
          created_at: now,
        },
        {
          id: 3,
          code: 'partial_refund',
          name: 'Partial refund',
          description: 'Partial refund to the student',
          affects_reliability_score: true,
          requires_payout_adjustment: true,
          created_at: now,
        },
      ]);
    }

    const [typeRows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS c FROM dispute_types',
    );
    const typeCount = Number(typeRows[0]?.c ?? 0);
    if (typeCount === 0) {
      const now = new Date();
      await queryInterface.bulkInsert('dispute_types', [
        {
          id: 1,
          code: 'service_issue',
          name: 'Service issue',
          description: 'Lesson quality, no-show, or other service problem',
          default_escalation_hours: 48,
          severity: 'medium',
          created_at: now,
        },
        {
          id: 2,
          code: 'billing',
          name: 'Billing / payment',
          description: 'Incorrect charge or payment dispute',
          default_escalation_hours: 48,
          severity: 'medium',
          created_at: now,
        },
        {
          id: 3,
          code: 'other',
          name: 'Other',
          description: 'Other dispute',
          default_escalation_hours: 72,
          severity: 'low',
          created_at: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM dispute_resolution_actions
      WHERE code IN ('approved_refund', 'no_action', 'partial_refund')
    `);
    // Do not delete dispute_types here: parent delete can CASCADE-remove disputes.
  },
};
