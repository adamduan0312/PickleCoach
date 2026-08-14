'use strict';

/**
 * `escrow_status = held` means captured funds only.
 * Add `pending` for authorized / not-yet-captured PaymentIntents.
 * Backfill uncaptured rows that were incorrectly left on `held`.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE payments
      MODIFY COLUMN escrow_status ENUM(
        'pending',
        'held',
        'released',
        'refunded',
        'disputed',
        'manual_payout_required',
        'pending_release'
      )
      NOT NULL DEFAULT 'pending'
    `);

    await queryInterface.sequelize.query(`
      UPDATE payments
      SET escrow_status = 'pending'
      WHERE escrow_status = 'held'
        AND payment_status IN ('pending', 'authorized', 'pending_capture')
        AND charge_id IS NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE payments
      SET escrow_status = 'released'
      WHERE escrow_status = 'held'
        AND payment_status IN ('failed', 'pending_void')
        AND charge_id IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE payments
      SET escrow_status = 'held'
      WHERE escrow_status = 'pending'
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
};
