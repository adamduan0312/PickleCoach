'use strict';

/**
 * MVP reviews only store booking, rating, and optional comment.
 * attendance_badges was never used by the API after the review contract simplification.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('reviews', 'attendance_badges');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('reviews', 'attendance_badges', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },
};
