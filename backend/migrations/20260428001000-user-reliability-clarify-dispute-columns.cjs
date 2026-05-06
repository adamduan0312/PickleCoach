'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('user_reliability', { transaction });

      if (table.late_arrivals && !table.late_arrival_disputes) {
        await queryInterface.renameColumn(
          'user_reliability',
          'late_arrivals',
          'late_arrival_disputes',
          { transaction },
        );
      }

      if (!table.student_no_show_disputes) {
        await queryInterface.addColumn(
          'user_reliability',
          'student_no_show_disputes',
          {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
            after: 'coach_no_show_disputes',
          },
          { transaction },
        );
      }

      // Backfill existing student rows: this bucket used to be stored in coach_no_show_disputes.
      await queryInterface.sequelize.query(
        `
          UPDATE user_reliability
          SET
            student_no_show_disputes = COALESCE(coach_no_show_disputes, 0),
            coach_no_show_disputes = 0
          WHERE role = 'student'
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const table = await queryInterface.describeTable('user_reliability', { transaction });

      if (table.student_no_show_disputes) {
        // Preserve existing counts when rolling back schema.
        await queryInterface.sequelize.query(
          `
            UPDATE user_reliability
            SET coach_no_show_disputes = COALESCE(coach_no_show_disputes, 0) + COALESCE(student_no_show_disputes, 0)
            WHERE role = 'student'
          `,
          { transaction },
        );

        await queryInterface.removeColumn('user_reliability', 'student_no_show_disputes', { transaction });
      }

      if (!table.late_arrivals && table.late_arrival_disputes) {
        await queryInterface.renameColumn(
          'user_reliability',
          'late_arrival_disputes',
          'late_arrivals',
          { transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
