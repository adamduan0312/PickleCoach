'use strict';

/**
 * Removes tables with no application usage (no controllers/routes/workers).
 * Dashboard stats use live queries, not admin_analytics.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = [
      'admin_analytics',
      'coach_reports',
      'user_badges',
      'session_history',
      'promo_codes',
    ];
    for (const t of q) {
      await queryInterface.dropTable(t);
    }
  },

  async down() {
    // Irreversible here; restore from backup or re-apply initial schema migrations in a fresh DB.
  },
};
