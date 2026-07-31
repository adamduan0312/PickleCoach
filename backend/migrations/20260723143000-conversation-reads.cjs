'use strict';

/**
 * Per-user conversation read cursors for inbox unread_count badges.
 * Unread = messages from others after last_read_at (or all incoming if never read).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = new Set(
      tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name || '')),
    );
    if (names.has('conversation_reads')) return;

    await queryInterface.createTable('conversation_reads', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      conversation_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'conversations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      last_read_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('conversation_reads', ['conversation_id', 'user_id'], {
      unique: true,
      name: 'conversation_reads_conversation_user_unique',
    });
    await queryInterface.addIndex('conversation_reads', ['user_id'], {
      name: 'conversation_reads_user_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('conversation_reads');
  },
};
