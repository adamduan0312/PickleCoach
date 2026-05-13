'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE payment_actions MODIFY COLUMN action_type ENUM(
        'dispute_refund_full',
        'dispute_refund_partial',
        'booking_cancel_refund',
        'booking_coach_no_show_refund',
        'booking_admin_refund'
      ) NOT NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE payment_actions
       SET action_type = 'dispute_refund_partial'
       WHERE action_type IN ('booking_cancel_refund','booking_coach_no_show_refund','booking_admin_refund')`,
    );

    await queryInterface.sequelize.query(
      `ALTER TABLE payment_actions MODIFY COLUMN action_type ENUM(
        'dispute_refund_full',
        'dispute_refund_partial'
      ) NOT NULL`,
    );
  },
};
