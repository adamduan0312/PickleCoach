'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface) {
    const tableDesc = await queryInterface.describeTable('coach_availabilities');
    if (tableDesc.start_datetime) {
      await queryInterface.removeColumn('coach_availabilities', 'start_datetime');
    }
    if (tableDesc.end_datetime) {
      await queryInterface.removeColumn('coach_availabilities', 'end_datetime');
    }
  },

  async down(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('coach_availabilities');
    if (!tableDesc.start_datetime) {
      await queryInterface.addColumn('coach_availabilities', 'start_datetime', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!tableDesc.end_datetime) {
      await queryInterface.addColumn('coach_availabilities', 'end_datetime', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },
};
