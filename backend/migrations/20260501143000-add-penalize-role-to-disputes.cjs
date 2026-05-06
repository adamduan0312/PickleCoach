'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn(
        'disputes',
        'penalize_role',
        {
          type: Sequelize.ENUM('coach', 'student', 'none'),
          allowNull: false,
          defaultValue: 'none',
          after: 'decision',
        },
        { transaction },
      );

      // Backfill existing behavior disputes from legacy complaint-direction inference.
      await queryInterface.sequelize.query(
        `
          UPDATE disputes d
          INNER JOIN dispute_types dt ON dt.id = d.dispute_type_id
          SET d.penalize_role = CASE
            WHEN dt.code IN ('late_arrival', 'misconduct', 'lesson_not_completed') AND d.opened_by = 'student' THEN 'coach'
            WHEN dt.code IN ('late_arrival', 'misconduct', 'lesson_not_completed') AND d.opened_by = 'coach' THEN 'student'
            ELSE 'none'
          END
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('disputes', 'penalize_role', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
