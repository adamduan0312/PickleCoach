'use strict';

/**
 * Legacy resolved disputes may have resolution_action_id NULL (before API required it).
 * Backfill to `no_action` so rows are consistent and reliability can rely on FK + flags only.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE disputes d
      INNER JOIN dispute_resolution_actions dra ON dra.code = 'no_action'
      SET d.resolution_action_id = dra.id
      WHERE d.status = 'resolved'
        AND d.resolution_action_id IS NULL
    `);
  },

  async down() {
    // Cannot safely restore prior nulls; no-op.
  },
};
