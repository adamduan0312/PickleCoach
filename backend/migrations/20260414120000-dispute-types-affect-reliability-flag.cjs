'use strict';

/**
 * Add type-level reliability eligibility gate for dispute scoring.
 * Reliability-impacting dispute types:
 * - coach_no_show
 * - late_arrival
 * - misconduct
 * - lesson_not_completed
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('dispute_types', 'affects_reliability_score', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'severity',
    });

    await queryInterface.sequelize.query(`
      UPDATE dispute_types
      SET affects_reliability_score = 1
      WHERE code IN ('coach_no_show', 'late_arrival', 'misconduct', 'lesson_not_completed')
    `);

    await queryInterface.sequelize.query(`
      UPDATE dispute_types
      SET affects_reliability_score = 0
      WHERE code IN ('refund_request', 'billing_issue', 'other')
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('dispute_types', 'affects_reliability_score');
  },
};
