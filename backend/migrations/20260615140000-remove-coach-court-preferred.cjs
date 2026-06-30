'use strict';

/** preferred only affected list sort order and was not used by booking, pricing, or availability. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('coach_court_locations', 'preferred');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('coach_court_locations', 'preferred', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
