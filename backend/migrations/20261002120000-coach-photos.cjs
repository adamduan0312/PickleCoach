'use strict';

/**
 * Coach "On the court" gallery photos — separate from the account avatar (users.avatar_url).
 * Ordered by `position`; the first photo is the cover (featured image).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('coach_photos', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      coach_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      url: { type: Sequelize.STRING(512), allowNull: false },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('coach_photos', ['coach_id', 'position']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('coach_photos');
  },
};
