'use strict';

/**
 * Add neutral attendance dispute outcome `lesson_occurred`:
 * lesson happened; neither party is a no-show. Used when rejecting an
 * attendance claim without attributing a no-show.
 *
 * ENUM becomes: coach_no_show | student_no_show | lesson_occurred
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE disputes
        MODIFY COLUMN outcome ENUM('coach_no_show', 'student_no_show', 'lesson_occurred') NULL
        `,
        { transaction },
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Rows using lesson_occurred cannot shrink the ENUM — clear them first.
      await queryInterface.sequelize.query(
        `
        UPDATE disputes
        SET outcome = NULL
        WHERE outcome = 'lesson_occurred'
        `,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE disputes
        MODIFY COLUMN outcome ENUM('coach_no_show', 'student_no_show') NULL
        `,
        { transaction },
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
