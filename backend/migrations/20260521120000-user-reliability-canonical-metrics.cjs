'use strict';

/**
 * Canonical user_reliability metrics: recent + decayed splits, totals, denominator metadata,
 * reconstructible scores, and removal of legacy overloaded columns.
 *
 * Post-migration: run `npm run reliability:recompute:all` once so decayed fractions are recomputed
 * from source (this migration backfills decayed=0 from legacy integers).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    const dialect = q.getDialect();
    if (dialect !== 'mysql' && dialect !== 'postgres') {
      throw new Error('Migration 20260521120000-user-reliability-canonical-metrics requires mysql or postgres.');
    }

    const table = await queryInterface.describeTable('user_reliability');
    if (table.booking_baseline_total) {
      return;
    }

    const decimal = (precision, scale) =>
      dialect === 'postgres' ? Sequelize.DECIMAL(precision, scale) : Sequelize.DECIMAL(precision, scale);

    const addCol = async (name, def) => {
      if (!table[name]) {
        await queryInterface.addColumn('user_reliability', name, def);
      }
    };

    if (dialect === 'mysql' && !table.id) {
      await q.query(
        'ALTER TABLE user_reliability ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE',
      );
    }

    await addCol('booking_baseline_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('booking_baseline_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('booking_baseline_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('total_bookings_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });

    await addCol('penalized_reschedules_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('penalized_reschedules_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('penalized_reschedules_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('late_cancels_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('late_cancels_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('late_cancels_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('coach_cancels_non_late_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('coach_cancels_non_late_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('coach_cancels_non_late_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('student_cancels_non_late_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('student_cancels_non_late_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('student_cancels_non_late_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('no_shows_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('no_shows_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('no_shows_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('late_arrival_penalties_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('late_arrival_penalties_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('late_arrival_penalties_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('misconduct_penalties_recent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addCol('misconduct_penalties_decayed', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });
    await addCol('misconduct_penalties_total', { type: decimal(20, 10), allowNull: false, defaultValue: 0 });

    await addCol('lesson_not_completed_penalties_recent', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await addCol('lesson_not_completed_penalties_decayed', {
      type: decimal(20, 10),
      allowNull: false,
      defaultValue: 0,
    });
    await addCol('lesson_not_completed_penalties_total', {
      type: decimal(20, 10),
      allowNull: false,
      defaultValue: 0,
    });

    await addCol('smoothing_k', { type: decimal(12, 6), allowNull: false, defaultValue: 5 });
    await addCol('decay_lambda', { type: decimal(12, 6), allowNull: false, defaultValue: 0.03 });
    await addCol('scoring_window_days', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 90 });
    await addCol('last_recomputed_at', { type: Sequelize.DATE, allowNull: true });
    await addCol('score_version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
    await addCol('score_source', { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'computed' });
    await addCol('reliability_reset_at', { type: Sequelize.DATE, allowNull: true });

    if (!table.created_at) {
      await queryInterface.addColumn('user_reliability', 'created_at', {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      });
    }

    const descAfter = await queryInterface.describeTable('user_reliability');
    if (descAfter.total_bookings) {
      await q.query(`
        UPDATE user_reliability
        SET
          booking_baseline_recent = COALESCE(total_bookings, 0),
          booking_baseline_decayed = 0,
          booking_baseline_total = COALESCE(total_bookings, 0),
          total_bookings_recent = COALESCE(total_bookings, 0),
          penalized_reschedules_recent = COALESCE(reschedules, 0),
          penalized_reschedules_decayed = 0,
          penalized_reschedules_total = COALESCE(reschedules, 0),
          late_cancels_recent = COALESCE(late_cancels, 0),
          late_cancels_decayed = 0,
          late_cancels_total = COALESCE(late_cancels, 0),
          coach_cancels_non_late_recent = CASE WHEN role = 'coach' THEN COALESCE(coach_cancels, 0) ELSE 0 END,
          coach_cancels_non_late_decayed = 0,
          coach_cancels_non_late_total = CASE WHEN role = 'coach' THEN COALESCE(coach_cancels, 0) ELSE 0 END,
          student_cancels_non_late_recent = CASE WHEN role = 'student' THEN COALESCE(coach_cancels, 0) ELSE 0 END,
          student_cancels_non_late_decayed = 0,
          student_cancels_non_late_total = CASE WHEN role = 'student' THEN COALESCE(coach_cancels, 0) ELSE 0 END,
          no_shows_recent = COALESCE(no_shows, 0),
          no_shows_decayed = 0,
          no_shows_total = COALESCE(no_shows, 0),
          late_arrival_penalties_recent = COALESCE(late_arrival_penalties, 0),
          late_arrival_penalties_decayed = 0,
          late_arrival_penalties_total = COALESCE(late_arrival_penalties, 0),
          misconduct_penalties_recent = COALESCE(misconduct_penalties, 0),
          misconduct_penalties_decayed = 0,
          misconduct_penalties_total = COALESCE(misconduct_penalties, 0),
          lesson_not_completed_penalties_recent = COALESCE(lesson_not_completed_penalties, 0),
          lesson_not_completed_penalties_decayed = 0,
          lesson_not_completed_penalties_total = COALESCE(lesson_not_completed_penalties, 0),
          last_recomputed_at = COALESCE(last_updated, NOW()),
          score_source = 'computed'
      `);
    }

    const legacyCols = [
      'total_bookings',
      'reschedules',
      'late_cancels',
      'coach_cancels',
      'no_shows',
      'late_arrival_penalties',
      'misconduct_penalties',
      'lesson_not_completed_penalties',
    ];
    const descFinal = await queryInterface.describeTable('user_reliability');
    for (const col of legacyCols) {
      if (descFinal[col]) {
        await queryInterface.removeColumn('user_reliability', col);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const table = await queryInterface.describeTable('user_reliability');
    if (!table.booking_baseline_total) {
      return;
    }

    await queryInterface.addColumn('user_reliability', 'total_bookings', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'reschedules', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'late_cancels', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'coach_cancels', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'no_shows', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'late_arrival_penalties', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'misconduct_penalties', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('user_reliability', 'lesson_not_completed_penalties', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    const q = queryInterface.sequelize;
    await q.query(`
      UPDATE user_reliability
      SET
        total_bookings = total_bookings_recent,
        reschedules = penalized_reschedules_recent,
        late_cancels = late_cancels_recent,
        coach_cancels = CASE
          WHEN role = 'coach' THEN coach_cancels_non_late_recent
          ELSE student_cancels_non_late_recent
        END,
        no_shows = no_shows_recent,
        late_arrival_penalties = late_arrival_penalties_recent,
        misconduct_penalties = misconduct_penalties_recent,
        lesson_not_completed_penalties = lesson_not_completed_penalties_recent
    `);

    const dropIf = async (name) => {
      const t = await queryInterface.describeTable('user_reliability');
      if (t[name]) {
        await queryInterface.removeColumn('user_reliability', name);
      }
    };

    const newCols = [
      'booking_baseline_recent',
      'booking_baseline_decayed',
      'booking_baseline_total',
      'total_bookings_recent',
      'penalized_reschedules_recent',
      'penalized_reschedules_decayed',
      'penalized_reschedules_total',
      'late_cancels_recent',
      'late_cancels_decayed',
      'late_cancels_total',
      'coach_cancels_non_late_recent',
      'coach_cancels_non_late_decayed',
      'coach_cancels_non_late_total',
      'student_cancels_non_late_recent',
      'student_cancels_non_late_decayed',
      'student_cancels_non_late_total',
      'no_shows_recent',
      'no_shows_decayed',
      'no_shows_total',
      'late_arrival_penalties_recent',
      'late_arrival_penalties_decayed',
      'late_arrival_penalties_total',
      'misconduct_penalties_recent',
      'misconduct_penalties_decayed',
      'misconduct_penalties_total',
      'lesson_not_completed_penalties_recent',
      'lesson_not_completed_penalties_decayed',
      'lesson_not_completed_penalties_total',
      'smoothing_k',
      'decay_lambda',
      'scoring_window_days',
      'last_recomputed_at',
      'score_version',
      'score_source',
      'reliability_reset_at',
    ];
    for (const c of newCols) {
      await dropIf(c);
    }

    await dropIf('created_at');

    const t2 = await queryInterface.describeTable('user_reliability');
    if (dialect === 'mysql' && t2.id) {
      await queryInterface.removeColumn('user_reliability', 'id');
    }
  },
};
