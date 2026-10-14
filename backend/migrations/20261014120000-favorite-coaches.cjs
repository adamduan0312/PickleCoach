'use strict';

/**
 * A student's saved coaches. Soft-deleted accounts keep their rows (same as bookings and
 * reviews); the API hides coaches who are no longer publicly active instead of deleting them.
 * A hard delete of either user removes the row.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('favorite_coaches', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('favorite_coaches', ['student_id', 'coach_id'], {
      unique: true,
      name: 'favorite_coaches_student_coach_unique',
    });
    await queryInterface.addIndex('favorite_coaches', ['coach_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('favorite_coaches');
  },
};
