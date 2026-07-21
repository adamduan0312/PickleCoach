'use strict';

/**
 * Drop late_arrival reliability buckets — product removed the dispute type and
 * scoring weight; columns are no longer part of the active schema.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable('user_reliability');
    for (const col of [
      'late_arrival_penalties_recent',
      'late_arrival_penalties_decayed',
      'late_arrival_penalties_total',
      'late_arrival_penalties',
    ]) {
      if (table[col]) {
        await queryInterface.removeColumn('user_reliability', col);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const decimal = (p, s) => Sequelize.DECIMAL(p, s);
    const table = await queryInterface.describeTable('user_reliability');
    if (!table.late_arrival_penalties_recent) {
      await queryInterface.addColumn('user_reliability', 'late_arrival_penalties_recent', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!table.late_arrival_penalties_decayed) {
      await queryInterface.addColumn('user_reliability', 'late_arrival_penalties_decayed', {
        type: decimal(20, 10),
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!table.late_arrival_penalties_total) {
      await queryInterface.addColumn('user_reliability', 'late_arrival_penalties_total', {
        type: decimal(20, 10),
        allowNull: false,
        defaultValue: 0,
      });
    }
  },
};
