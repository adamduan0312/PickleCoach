'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('coach_availabilities');

    if (!tableDesc.start_time) {
      await queryInterface.addColumn('coach_availabilities', 'start_time', {
        type: Sequelize.STRING(8),
        allowNull: true,
      });
    }

    if (!tableDesc.end_time) {
      await queryInterface.addColumn('coach_availabilities', 'end_time', {
        type: Sequelize.STRING(8),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('coach_availabilities', 'end_time').catch(() => {});
    await queryInterface.removeColumn('coach_availabilities', 'start_time').catch(() => {});
  },
};
