'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_bookings_status" ADD VALUE IF NOT EXISTS 'no_show';`
      );
    } else if (dialect === 'mysql') {
      await queryInterface.sequelize.query(
        `ALTER TABLE bookings MODIFY COLUMN status ENUM('pending', 'confirmed', 'awaiting_verification', 'completed', 'cancelled', 'disputed', 'no_show') DEFAULT 'pending';`
      );
    }
    // sqlite and others: model change is enough for sync; no enum type to alter
  },

  async down(queryInterface) {
    // Removing an enum value is DB-specific and can fail if any row has 'no_show'. Leave as no-op.
  },
};
