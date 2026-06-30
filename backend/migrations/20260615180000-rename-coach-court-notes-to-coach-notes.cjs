'use strict';

/** Semantic rename: per-coach text on coach_court_locations (not court entity data). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.renameColumn('coach_court_locations', 'notes', 'coach_notes');
  },

  async down(queryInterface) {
    await queryInterface.renameColumn('coach_court_locations', 'coach_notes', 'notes');
  },
};
