'use strict';

/**
 * Lesson offering type (informational only — bookings stay one paying student each).
 *
 * lesson_type: private | group (existing rows → private)
 * max_players: people the coach allows at a group lesson (NULL for private).
 *              Not a booking capacity; does not create participants.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn(
        'lessons',
        'lesson_type',
        {
          type: Sequelize.ENUM('private', 'group'),
          allowNull: false,
          defaultValue: 'private',
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'lessons',
        'max_players',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
        { transaction },
      );
      await queryInterface.sequelize.query(
        "UPDATE lessons SET lesson_type = 'private', max_players = NULL",
        { transaction },
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('lessons', 'max_players', { transaction });
      await queryInterface.removeColumn('lessons', 'lesson_type', { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
