'use strict';

/** Stripe as source of truth: partial refunds, manual payout escrow, refund tracking. */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN payment_status ENUM('pending','captured','failed','refunded','partially_refunded')
      DEFAULT 'pending'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN escrow_status ENUM('held','released','refunded','disputed','manual_payout_required')
      NOT NULL DEFAULT 'held'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      ADD COLUMN refund_status VARCHAR(20) NOT NULL DEFAULT 'none'
        COMMENT 'none|pending|succeeded|failed — mirrors refund lifecycle'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      ADD COLUMN stripe_refund_id VARCHAR(255) NULL
        COMMENT 'Latest Stripe refund id from API or webhook'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payments DROP COLUMN stripe_refund_id
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments DROP COLUMN refund_status
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN escrow_status ENUM('held','released','refunded','disputed')
      NOT NULL DEFAULT 'held'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN payment_status ENUM('pending','captured','failed','refunded')
      DEFAULT 'pending'
    `);
  },
};
