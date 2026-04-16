'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex('bookings', 'bookings_idempotency_key');
    await queryInterface.addIndex('bookings', ['primary_student_id', 'idempotency_key'], {
      unique: true,
      name: 'bookings_student_idempotency_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('bookings', 'bookings_student_idempotency_unique');
    await queryInterface.addIndex('bookings', ['idempotency_key'], {
      unique: true,
      name: 'bookings_idempotency_key',
    });
  },
};
