'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('coach_availabilities');
    if (tableDesc.recurrence_rule) {
      await queryInterface.removeColumn('coach_availabilities', 'recurrence_rule');
    }
    if (tableDesc.is_available) {
      await queryInterface.removeColumn('coach_availabilities', 'is_available');
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('coach_availabilities');
    if (!tableDesc.recurrence_rule) {
      await queryInterface.addColumn('coach_availabilities', 'recurrence_rule', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
    if (!tableDesc.is_available) {
      await queryInterface.addColumn('coach_availabilities', 'is_available', {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: true,
      });
    }
  },
};
