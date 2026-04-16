'use strict';

/**
 * API paths set pending_* only; webhooks finalize (payment_intent.succeeded, charge.refunded, transfer.*).
 */
module.exports = {
  async up(queryInterface) {
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
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN escrow_status ENUM(
        'held',
        'released',
        'refunded',
        'disputed',
        'manual_payout_required',
        'pending_release'
      )
      NOT NULL DEFAULT 'held'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE payments SET payment_status = 'pending' WHERE payment_status IN ('pending_capture','pending_void')
    `);
    await queryInterface.sequelize.query(`
      UPDATE payments SET escrow_status = 'held' WHERE escrow_status = 'pending_release'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN escrow_status ENUM('held','released','refunded','disputed','manual_payout_required')
      NOT NULL DEFAULT 'held'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN payment_status ENUM('pending','captured','failed','refunded','partially_refunded')
      DEFAULT 'pending'
    `);
  },
};
