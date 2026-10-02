'use strict';

/**
 * OSM pickleball features that nearby discovery already tried and could not import (no usable
 * address after reverse geocoding). Lets discovery skip them instead of repeating the ~1 req/sec
 * Nominatim lookup on every search; they are retried after a cooldown.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('osm_court_import_attempts', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      osm_type: { type: Sequelize.STRING(16), allowNull: false },
      osm_id: { type: Sequelize.BIGINT, allowNull: false },
      outcome: { type: Sequelize.STRING(32), allowNull: false },
      attempted_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('osm_court_import_attempts', ['osm_type', 'osm_id'], {
      unique: true,
      name: 'unique_osm_court_import_attempt',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('osm_court_import_attempts');
  },
};
