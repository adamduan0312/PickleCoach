'use strict';

/**
 * Snapshot of the lesson offering (private/group + max players) at booking time,
 * so later lesson edits don't rewrite booking history.
 *
 * Nullable: rows without a snapshot fall back to the lesson's current values.
 * Existing bookings are backfilled from their lesson (best available history).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn(
        'bookings',
        'lesson_type_at_booking',
        {
          type: Sequelize.ENUM('private', 'group'),
          allowNull: true,
          defaultValue: null,
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'bookings',
        'max_players_at_booking',
        {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE bookings b
           JOIN lessons l ON l.id = b.lesson_id
            SET b.lesson_type_at_booking = l.lesson_type,
                b.max_players_at_booking = l.max_players`,
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
      await queryInterface.removeColumn('bookings', 'max_players_at_booking', { transaction });
      await queryInterface.removeColumn('bookings', 'lesson_type_at_booking', { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
