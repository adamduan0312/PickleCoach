'use strict';

/** is_verified had no business logic or user-facing workflow; remove until a full moderation model exists. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('court_locations', 'is_verified');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('court_locations', 'is_verified', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
