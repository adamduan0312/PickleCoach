'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('bookings');
    if (!tableDesc.declined_at) {
      await queryInterface.addColumn('bookings', 'declined_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!tableDesc.decline_message_to_student) {
      await queryInterface.addColumn('bookings', 'decline_message_to_student', {
        type: Sequelize.STRING(500),
        allowNull: true,
      });
    }
    if (!tableDesc.decline_reason_code) {
      await queryInterface.addColumn('bookings', 'decline_reason_code', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('bookings', 'declined_at');
    await queryInterface.removeColumn('bookings', 'decline_message_to_student');
    await queryInterface.removeColumn('bookings', 'decline_reason_code');
  },
};
