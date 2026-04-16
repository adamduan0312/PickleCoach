'use strict';

/**
 * - Persist student/coach context on disputes (notes).
 * - Seed extra dispute_types rows 4–7 when missing (superseded by 20260408120000-canonical-dispute-types-mvp).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('disputes', 'notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    const q = queryInterface.sequelize;

    const rows = [
      {
        id: 4,
        code: 'coach_no_show',
        name: 'Coach no-show',
        description: 'Student reports the coach did not attend or was a no-show',
        default_escalation_hours: 48,
        severity: 'high',
      },
      {
        id: 5,
        code: 'late_arrival',
        name: 'Late arrival',
        description: 'Coach arrived late or lesson started significantly late',
        default_escalation_hours: 48,
        severity: 'medium',
      },
      {
        id: 6,
        code: 'misconduct',
        name: 'Misconduct',
        description: 'Safety, harassment, or other conduct issue',
        default_escalation_hours: 24,
        severity: 'high',
      },
      {
        id: 7,
        code: 'refund_request',
        name: 'Refund request',
        description: 'Student requests refund or billing correction (non-Stripe chargeback)',
        default_escalation_hours: 72,
        severity: 'medium',
      },
    ];

    for (const row of rows) {
      await q.query(
        `
        INSERT INTO dispute_types (id, code, name, description, default_escalation_hours, severity, created_at)
        SELECT :id, :code, :name, :description, :default_escalation_hours, :severity, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM dispute_types WHERE id = :id OR code = :code)
        `,
        { replacements: row },
      );
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('disputes', 'notes');
    // Intentionally do not delete dispute_types rows (may be referenced).
  },
};
