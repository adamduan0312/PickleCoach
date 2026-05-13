'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const desc = await queryInterface.describeTable('user_reliability');

    if (desc.late_arrival_disputes && !desc.late_arrival_penalties) {
      await queryInterface.renameColumn(
        'user_reliability',
        'late_arrival_disputes',
        'late_arrival_penalties',
      );
    }
    const desc2 = await queryInterface.describeTable('user_reliability');
    if (desc2.misconduct_disputes && !desc2.misconduct_penalties) {
      await queryInterface.renameColumn(
        'user_reliability',
        'misconduct_disputes',
        'misconduct_penalties',
      );
    }

    const desc3 = await queryInterface.describeTable('user_reliability');
    if (desc3.lesson_not_completed_disputes && !desc3.lesson_not_completed_penalties) {
      await queryInterface.renameColumn(
        'user_reliability',
        'lesson_not_completed_disputes',
        'lesson_not_completed_penalties',
      );
    }

    const desc4 = await queryInterface.describeTable('user_reliability');
    if (desc4.coach_no_show_disputes) {
      await queryInterface.removeColumn('user_reliability', 'coach_no_show_disputes');
    }
    const desc5 = await queryInterface.describeTable('user_reliability');
    if (desc5.student_no_show_disputes) {
      await queryInterface.removeColumn('user_reliability', 'student_no_show_disputes');
    }
  },

  async down(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('user_reliability');

    if (!desc.coach_no_show_disputes) {
      await queryInterface.addColumn('user_reliability', 'coach_no_show_disputes', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
    const desc1 = await queryInterface.describeTable('user_reliability');
    if (!desc1.student_no_show_disputes) {
      await queryInterface.addColumn('user_reliability', 'student_no_show_disputes', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    const desc2 = await queryInterface.describeTable('user_reliability');
    if (desc2.lesson_not_completed_penalties && !desc2.lesson_not_completed_disputes) {
      await queryInterface.renameColumn(
        'user_reliability',
        'lesson_not_completed_penalties',
        'lesson_not_completed_disputes',
      );
    }
    const desc3 = await queryInterface.describeTable('user_reliability');
    if (desc3.misconduct_penalties && !desc3.misconduct_disputes) {
      await queryInterface.renameColumn(
        'user_reliability',
        'misconduct_penalties',
        'misconduct_disputes',
      );
    }
    const desc4 = await queryInterface.describeTable('user_reliability');
    if (desc4.late_arrival_penalties && !desc4.late_arrival_disputes) {
      await queryInterface.renameColumn(
        'user_reliability',
        'late_arrival_penalties',
        'late_arrival_disputes',
      );
    }
  },
};
