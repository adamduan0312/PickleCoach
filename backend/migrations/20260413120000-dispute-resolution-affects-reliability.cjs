'use strict';

/**
 * Align `affects_reliability_score` with product meaning: late_arrival penalties apply
 * only when the chosen resolution action says so (approved_refund / partial_refund),
 * not for no_action. ReliabilityService counts resolved late_arrival disputes using this flag.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE dispute_resolution_actions
      SET affects_reliability_score = 1
      WHERE code IN ('approved_refund', 'partial_refund')
    `);
    await queryInterface.sequelize.query(`
      UPDATE dispute_resolution_actions
      SET affects_reliability_score = 0
      WHERE code = 'no_action'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE dispute_resolution_actions
      SET affects_reliability_score = 0
      WHERE code IN ('approved_refund', 'partial_refund', 'no_action')
    `);
  },
};
