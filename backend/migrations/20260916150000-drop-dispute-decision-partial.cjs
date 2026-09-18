'use strict';

/**
 * Drop disputes.decision value `partial` from the MVP contract.
 * Sustained claims use `upheld`; refund size stays on financial_action
 * (`refund_student` / `refund_student_partial`).
 *
 * Existing `partial` rows are rewritten to `upheld` before the ENUM shrinks.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        UPDATE disputes
        SET decision = 'upheld'
        WHERE decision = 'partial'
        `,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE disputes
        MODIFY COLUMN decision ENUM('upheld', 'rejected') NULL
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
      await queryInterface.sequelize.query(
        `
        ALTER TABLE disputes
        MODIFY COLUMN decision ENUM('upheld', 'rejected', 'partial') NULL
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
