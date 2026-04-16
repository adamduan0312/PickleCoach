'use strict';

/**
 * Canonical MVP dispute_types (ids 1–7). Updates existing rows in place; inserts any missing id.
 * Temporarily renames `code` to avoid UNIQUE(code) collisions while reshuffling.
 */

const MVP_TYPES = [
  {
    id: 1,
    code: 'coach_no_show',
    name: 'Coach no-show',
    description: 'Student reports the coach did not attend or was a no-show',
    default_escalation_hours: 48,
    severity: 'high',
  },
  {
    id: 2,
    code: 'late_arrival',
    name: 'Late arrival',
    description: 'Coach arrived late or the lesson started significantly late',
    default_escalation_hours: 48,
    severity: 'medium',
  },
  {
    id: 3,
    code: 'misconduct',
    name: 'Misconduct',
    description: 'Safety, harassment, or other conduct issue',
    default_escalation_hours: 24,
    severity: 'high',
  },
  {
    id: 4,
    code: 'lesson_not_completed',
    name: 'Lesson not completed',
    description: 'Lesson did not run to completion as expected (without a simple no-show)',
    default_escalation_hours: 48,
    severity: 'medium',
  },
  {
    id: 5,
    code: 'refund_request',
    name: 'Refund request',
    description: 'Student requests refund or compensation (non-Stripe chargeback)',
    default_escalation_hours: 72,
    severity: 'medium',
  },
  {
    id: 6,
    code: 'billing_issue',
    name: 'Billing issue',
    description: 'Incorrect charge, double charge, or payment processing issue',
    default_escalation_hours: 48,
    severity: 'medium',
  },
  {
    id: 7,
    code: 'other',
    name: 'Other',
    description: 'Other dispute (catch-all)',
    default_escalation_hours: 72,
    severity: 'low',
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    const dialect = q.getDialect();

    const tempCodeExpr =
      dialect === 'postgres'
        ? `('__migr_' || id::text)`
        : `CONCAT('__migr_', id)`;

    await q.transaction(async (transaction) => {
      for (const row of MVP_TYPES) {
        await q.query(`UPDATE dispute_types SET code = ${tempCodeExpr} WHERE id = :id`, {
          replacements: { id: row.id },
          transaction,
        });
      }

      for (const row of MVP_TYPES) {
        const [existing] = await q.query(
          `SELECT id FROM dispute_types WHERE id = :id`,
          { replacements: { id: row.id }, transaction },
        );
        const rows = Array.isArray(existing) ? existing : [];
        if (rows.length) {
          await q.query(
            `
            UPDATE dispute_types SET
              code = :code,
              name = :name,
              description = :description,
              default_escalation_hours = :default_escalation_hours,
              severity = :severity
            WHERE id = :id
            `,
            { replacements: row, transaction },
          );
        } else {
          await q.query(
            `
            INSERT INTO dispute_types (id, code, name, description, default_escalation_hours, severity, created_at)
            VALUES (:id, :code, :name, :description, :default_escalation_hours, :severity, CURRENT_TIMESTAMP)
            `,
            { replacements: row, transaction },
          );
        }
      }
    });
  },

  async down() {
    // Non-destructive: do not revert labels.
  },
};
