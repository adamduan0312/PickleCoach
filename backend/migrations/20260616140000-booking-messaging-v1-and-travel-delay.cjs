'use strict';

/** Booking messaging V1 schema + re-add travel_delay cancellation reason. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('cancellation_history', 'reason', {
      type: Sequelize.ENUM(
        'weather',
        'emergency',
        'sickness',
        'travel_delay',
        'schedule_conflict',
        'forgot',
        'other',
      ),
      allowNull: true,
    });

    await queryInterface.addColumn('conversations', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        DELETE c1 FROM conversations c1
        INNER JOIN conversations c2
          ON c1.booking_id = c2.booking_id AND c1.id > c2.id
      `);
      const msgIndexes = await queryInterface.showIndex('messages');
      const hasFt = msgIndexes.some(
        (i) => (i.Key_name != null ? i.Key_name : i.name) === 'ft_messages_content',
      );
      if (hasFt) {
        await queryInterface.sequelize.query('ALTER TABLE messages DROP INDEX ft_messages_content');
      }
      await queryInterface.sequelize.query(
        'ALTER TABLE messages CHANGE content message_text TEXT NOT NULL',
      );
      await queryInterface.removeColumn('messages', 'attachments');
      await queryInterface.removeColumn('messages', 'read_at');
    } else {
      await queryInterface.renameColumn('messages', 'content', 'message_text');
      await queryInterface.removeColumn('messages', 'attachments');
      await queryInterface.removeColumn('messages', 'read_at');
    }

    await queryInterface.addColumn('messages', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });

    try {
      await queryInterface.removeIndex('conversations', 'conversations_booking_id');
    } catch {
      // non-fatal if index name differs
    }

    await queryInterface.addIndex('conversations', ['booking_id'], {
      unique: true,
      name: 'conversations_booking_id_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('conversations', 'conversations_booking_id_unique');

    await queryInterface.removeColumn('messages', 'updated_at');
    await queryInterface.removeColumn('conversations', 'updated_at');

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query(
        'ALTER TABLE messages CHANGE message_text content TEXT NOT NULL',
      );
      await queryInterface.addColumn('messages', 'attachments', {
        type: Sequelize.JSON,
        allowNull: true,
      });
      await queryInterface.addColumn('messages', 'read_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    } else {
      await queryInterface.renameColumn('messages', 'message_text', 'content');
      await queryInterface.addColumn('messages', 'attachments', {
        type: Sequelize.JSON,
        allowNull: true,
      });
      await queryInterface.addColumn('messages', 'read_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(
      `UPDATE cancellation_history SET reason = 'other' WHERE reason = 'travel_delay'`,
    );
    await queryInterface.changeColumn('cancellation_history', 'reason', {
      type: Sequelize.ENUM(
        'weather',
        'emergency',
        'sickness',
        'schedule_conflict',
        'forgot',
        'other',
      ),
      allowNull: true,
    });

    await queryInterface.addIndex('conversations', ['booking_id'], {
      name: 'conversations_booking_id',
    });
  },
};
