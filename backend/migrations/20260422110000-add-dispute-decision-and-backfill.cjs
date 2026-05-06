'use strict';

/**
 * Add canonical admin decision field to disputes and backfill existing rows.
 * Decision model:
 * - upheld
 * - rejected
 * - partial
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('disputes', 'decision', {
      type: Sequelize.ENUM('upheld', 'rejected', 'partial'),
      allowNull: true,
      after: 'resolution_notes',
    });

    const q = queryInterface.sequelize;

    // Legacy rejected rows map directly to canonical rejected decision.
    await q.query(`
      UPDATE disputes
      SET decision = 'rejected'
      WHERE decision IS NULL AND status = 'rejected'
    `);

    // Attendance claims: infer decision from final booking status vs claim direction.
    await q.query(`
      UPDATE disputes d
      INNER JOIN dispute_types dt ON dt.id = d.dispute_type_id
      INNER JOIN bookings b ON b.id = d.booking_id
      SET d.decision = CASE
        WHEN dt.code = 'coach_no_show_claim' AND b.status = 'coach_no_show' THEN 'upheld'
        WHEN dt.code = 'student_no_show_claim' AND b.status = 'student_no_show' THEN 'upheld'
        WHEN dt.code IN ('coach_no_show_claim', 'student_no_show_claim') THEN 'rejected'
        ELSE d.decision
      END
      WHERE d.decision IS NULL
        AND d.status = 'resolved'
        AND dt.code IN ('coach_no_show_claim', 'student_no_show_claim')
    `);

    // Remaining resolved disputes default to rejected when no explicit signal exists.
    // This avoids inflating "claim upheld" metrics from ambiguous legacy data.
    await q.query(`
      UPDATE disputes
      SET decision = 'rejected'
      WHERE decision IS NULL AND status = 'resolved'
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('disputes', 'decision');
  },
};
