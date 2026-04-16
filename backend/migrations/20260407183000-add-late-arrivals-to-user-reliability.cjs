'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_reliability', 'late_arrivals', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      after: 'late_cancels',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('user_reliability', 'late_arrivals');
  },
};
