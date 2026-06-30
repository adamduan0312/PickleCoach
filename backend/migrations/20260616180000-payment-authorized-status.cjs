'use strict';

/**
 * Manual-capture bookings: `authorized` = Stripe PI requires_capture (funds held, not yet captured).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN payment_status ENUM(
        'pending',
        'authorized',
        'captured',
        'failed',
        'refunded',
        'partially_refunded',
        'pending_capture',
        'pending_void'
      )
      DEFAULT 'pending'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE payments SET payment_status = 'pending' WHERE payment_status = 'authorized'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN payment_status ENUM(
        'pending',
        'captured',
        'failed',
        'refunded',
        'partially_refunded',
        'pending_capture',
        'pending_void'
      )
      DEFAULT 'pending'
    `);
  },
};
