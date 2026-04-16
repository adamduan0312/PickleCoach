'use strict';

/**
 * Older seed migration only filled dispute_types / dispute_resolution_actions when
 * the table was completely empty. If rows existed without id=1, create dispute failed.
 * This migration inserts each canonical row by id only when that id is missing.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    const actionInserts = [
      {
        id: 1,
        code: 'approved_refund',
        name: 'Approved refund',
        description: 'Refund approved (e.g. service issue)',
        affects_reliability_score: 1,
        requires_payout_adjustment: 1,
      },
      {
        id: 2,
        code: 'no_action',
        name: 'No action',
        description: 'Dispute closed without payout change',
        affects_reliability_score: 0,
        requires_payout_adjustment: 0,
      },
      {
        id: 3,
        code: 'partial_refund',
        name: 'Partial refund',
        description: 'Partial refund to the student',
        affects_reliability_score: 1,
        requires_payout_adjustment: 1,
      },
    ];

    for (const row of actionInserts) {
      await q.query(
        `
        INSERT INTO dispute_resolution_actions (id, code, name, description, affects_reliability_score, requires_payout_adjustment, created_at)
        SELECT :id, :code, :name, :description, :affects_reliability_score, :requires_payout_adjustment, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM dispute_resolution_actions WHERE id = :id)
        `,
        { replacements: row },
      );
    }

    const typeInserts = [
      {
        id: 1,
        code: 'service_issue',
        name: 'Service issue',
        description: 'Lesson quality, no-show, or other service problem',
        default_escalation_hours: 48,
        severity: 'medium',
      },
      {
        id: 2,
        code: 'billing',
        name: 'Billing / payment',
        description: 'Incorrect charge or payment dispute',
        default_escalation_hours: 48,
        severity: 'medium',
      },
      {
        id: 3,
        code: 'other',
        name: 'Other',
        description: 'Other dispute',
        default_escalation_hours: 72,
        severity: 'low',
      },
    ];

    for (const row of typeInserts) {
      await q.query(
        `
        INSERT INTO dispute_types (id, code, name, description, default_escalation_hours, severity, created_at)
        SELECT :id, :code, :name, :description, :default_escalation_hours, :severity, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM dispute_types WHERE id = :id)
        `,
        { replacements: row },
      );
    }
  },

  async down() {
    // Non-destructive: do not delete rows that may be referenced by disputes.
  },
};
