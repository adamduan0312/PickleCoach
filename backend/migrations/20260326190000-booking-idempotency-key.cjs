'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('bookings', 'idempotency_key', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addIndex('bookings', ['idempotency_key'], {
      unique: true,
      name: 'bookings_idempotency_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('bookings', 'bookings_idempotency_key');
    await queryInterface.removeColumn('bookings', 'idempotency_key');
  },
};
