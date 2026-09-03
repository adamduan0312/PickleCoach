'use strict';

/**
 * One notification row per user + type + channel + entity.
 * Closes check-then-act races (reminder cron overlap, webhook replay, concurrent notify*).
 * Rows without entity_id stay unconstrained (auth / one-off mail).
 */

const INDEX_NAME = 'notifications_logical_event_unique';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE n1 FROM notifications n1
      INNER JOIN notifications n2
        ON n1.user_id = n2.user_id
       AND n1.type = n2.type
       AND n1.channel = n2.channel
       AND n1.entity_type <=> n2.entity_type
       AND n1.entity_id <=> n2.entity_id
       AND n1.entity_id IS NOT NULL
       AND n1.id > n2.id
    `);

    const indexes = await queryInterface.showIndex('notifications');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));
    if (!names.has(INDEX_NAME)) {
      await queryInterface.addIndex(
        'notifications',
        ['user_id', 'type', 'channel', 'entity_type', 'entity_id'],
        { unique: true, name: INDEX_NAME },
      );
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('notifications');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));
    if (names.has(INDEX_NAME)) {
      await queryInterface.removeIndex('notifications', INDEX_NAME);
    }
  },
};
