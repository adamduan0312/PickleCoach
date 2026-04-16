'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_reliability', 'coach_no_show_disputes', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      after: 'late_arrivals',
    });
    await queryInterface.addColumn('user_reliability', 'misconduct_disputes', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      after: 'coach_no_show_disputes',
    });
    await queryInterface.addColumn('user_reliability', 'lesson_not_completed_disputes', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      after: 'misconduct_disputes',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('user_reliability', 'lesson_not_completed_disputes');
    await queryInterface.removeColumn('user_reliability', 'misconduct_disputes');
    await queryInterface.removeColumn('user_reliability', 'coach_no_show_disputes');
  },
};
