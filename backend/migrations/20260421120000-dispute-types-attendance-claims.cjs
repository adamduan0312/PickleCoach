'use strict';

/**
 * Attendance disputes: separate **claim** (dispute_types) from **outcome** (bookings.status).
 * - id 1: rename `coach_no_show` → `coach_no_show_claim` (student alleges coach did not attend).
 * - id 8: `student_no_show_claim` (coach alleges student did not attend).
 * - Data fix: disputes that were type 1 + opened_by coach → type 8 (wrong type was used historically).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    const [existing] = await q.query(
      `SELECT id FROM dispute_types WHERE code = 'student_no_show_claim' OR id = 8 LIMIT 1`,
    );
    const rows = Array.isArray(existing) ? existing : [];
    if (!rows.length) {
      const now = new Date();
      await queryInterface.bulkInsert('dispute_types', [
        {
          id: 8,
          code: 'student_no_show_claim',
          name: 'Student no-show (claim)',
          description:
            'Coach claims the primary student did not attend (pending admin resolution).',
          default_escalation_hours: 48,
          severity: 'high',
          affects_reliability_score: true,
          created_at: now,
        },
      ]);
    }

    await q.query(`
      UPDATE disputes
      SET dispute_type_id = 8
      WHERE dispute_type_id = 1 AND opened_by = 'coach'
    `);

    await q.query(`
      UPDATE dispute_types
      SET
        code = 'coach_no_show_claim',
        name = 'Coach no-show (claim)',
        description = 'Student claims the coach did not attend or was a no-show (pending admin resolution).'
      WHERE id = 1 AND code IN ('coach_no_show', 'coach_no_show_claim')
    `);

    await q.query(`
      UPDATE dispute_types
      SET affects_reliability_score = 1
      WHERE code IN ('coach_no_show_claim', 'student_no_show_claim')
    `);
  },

  async down(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(`
      UPDATE disputes
      SET dispute_type_id = 1
      WHERE dispute_type_id = 8 AND opened_by = 'coach'
    `);
    await q.query(`DELETE FROM dispute_types WHERE id = 8 AND code = 'student_no_show_claim'`);
    await q.query(`
      UPDATE dispute_types
      SET code = 'coach_no_show', name = 'Coach no-show', description = 'Student reports the coach did not attend or was a no-show'
      WHERE id = 1 AND code = 'coach_no_show_claim'
    `);
  },
};
