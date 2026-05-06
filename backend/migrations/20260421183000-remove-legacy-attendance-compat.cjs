'use strict';

/**
 * Development cleanup: remove legacy attendance compatibility rows/data.
 * - dispute_types: collapse any remaining `coach_no_show` rows into id=1 (`coach_no_show_claim`) and delete leftovers.
 * - bookings: migrate legacy `no_show` status rows to `student_no_show`.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    // Ensure canonical attendance claim row exists at id=1.
    await q.query(`
      UPDATE dispute_types
      SET code = 'coach_no_show_claim',
          name = 'Coach no-show (claim)',
          description = 'Student claims the coach did not attend or was a no-show (pending admin resolution).'
      WHERE id = 1
    `);

    // Repoint disputes from any non-canonical legacy type rows to id=1.
    await q.query(`
      UPDATE disputes d
      INNER JOIN dispute_types dt ON dt.id = d.dispute_type_id
      SET d.dispute_type_id = 1
      WHERE dt.code = 'coach_no_show' AND dt.id <> 1
    `);

    // Remove any leftover legacy dispute type rows.
    await q.query(`
      DELETE FROM dispute_types
      WHERE code = 'coach_no_show' AND id <> 1
    `);

    // Eliminate legacy booking status rows.
    await q.query(`
      UPDATE bookings
      SET status = 'student_no_show'
      WHERE status = 'no_show'
    `);
  },

  async down() {
    // Irreversible cleanup migration for development environments.
  },
};

