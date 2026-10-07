'use strict';

/**
 * Privacy belongs to a coach's use of a court, not to the shared court: one coach may teach
 * privately at a facility another coach advertises publicly. Existing links inherit the court's
 * current flag so nothing that is redacted today becomes visible.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('coach_court_locations', 'is_private', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.sequelize.query(`
      UPDATE coach_court_locations l
      JOIN court_locations c ON c.id = l.court_id
      SET l.is_private = 1
      WHERE c.is_private = 1
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('coach_court_locations', 'is_private');
  },
};
