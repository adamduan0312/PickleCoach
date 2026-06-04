'use strict';

/** Lesson `price` + `duration_minutes` is the billing source of truth; profile hourly rate was unused in checkout. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('coach_profiles', 'hourly_rate');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('coach_profiles', 'hourly_rate', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.0,
    });
  },
};
