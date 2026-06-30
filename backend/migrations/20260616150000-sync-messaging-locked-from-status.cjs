'use strict';

/** Backfill `messaging_locked` from `status` so DB matches centralized lifecycle rules. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE bookings
      SET messaging_locked = CASE
        WHEN status IN ('confirmed', 'awaiting_verification') THEN 0
        ELSE 1
      END
    `);
  },

  async down() {
    // Non-reversible data backfill; no-op.
  },
};
