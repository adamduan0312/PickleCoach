'use strict';

/**
 * Add OSM identity columns for stable court discovery dedupe.
 * Manual courts leave these null; imported OSM courts set both.
 * Unique on (osm_type, osm_id) only when both are non-null (MySQL allows
 * multiple NULLs in a unique index).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('court_locations', 'osm_type', {
      type: Sequelize.STRING(16),
      allowNull: true,
      comment: 'OSM element type: node | way | relation',
    });
    await queryInterface.addColumn('court_locations', 'osm_id', {
      type: Sequelize.BIGINT,
      allowNull: true,
      comment: 'OSM element id',
    });
    await queryInterface.addIndex('court_locations', ['osm_type', 'osm_id'], {
      unique: true,
      name: 'unique_court_osm',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('court_locations', 'unique_court_osm').catch(() => {});
    await queryInterface.removeColumn('court_locations', 'osm_id').catch(() => {});
    await queryInterface.removeColumn('court_locations', 'osm_type').catch(() => {});
  },
};
