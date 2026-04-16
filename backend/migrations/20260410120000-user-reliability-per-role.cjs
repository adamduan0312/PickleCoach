'use strict';

/**
 * Composite primary key (user_id, role) so coach and student reliability are separate rows.
 * role: 'coach' | 'student' (stored as VARCHAR for cross-dialect simplicity).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    const dialect = q.getDialect();

    if (dialect !== 'mysql' && dialect !== 'postgres') {
      throw new Error(
        'Migration 20260410120000-user-reliability-per-role requires mysql or postgres (composite PK change).',
      );
    }

    await q.transaction(async (transaction) => {
      const table = await queryInterface.describeTable('user_reliability', { transaction });
      const hasRoleColumn = Boolean(table.role);
      if (!hasRoleColumn) {
        await queryInterface.addColumn(
          'user_reliability',
          'role',
          {
            type: Sequelize.STRING(20),
            allowNull: true,
          },
          { transaction },
        );
      }

      await q.query(
        `UPDATE user_reliability ur
         SET role = 'student'
         WHERE EXISTS (
           SELECT 1 FROM user_roles r
           WHERE r.user_id = ur.user_id AND r.role = 'student'
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_roles r2
           WHERE r2.user_id = ur.user_id AND r2.role = 'coach'
         )`,
        { transaction },
      );

      await q.query(`UPDATE user_reliability SET role = 'coach' WHERE role IS NULL`, { transaction });

      await q.query(
        `INSERT INTO user_reliability
          (user_id, role, total_bookings, reschedules, paid_reschedules, late_cancels, no_shows, coach_cancels, reliability_score, last_updated)
         SELECT u.id, 'student', 0, 0, 0, 0, 0, 0, 100.00, NOW()
         FROM users u
         WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'student')
           AND EXISTS (SELECT 1 FROM user_roles r2 WHERE r2.user_id = u.id AND r2.role = 'coach')
           AND NOT EXISTS (
             SELECT 1 FROM user_reliability ur
             WHERE ur.user_id = u.id AND ur.role = 'student'
           )`,
        { transaction },
      );

      await queryInterface.changeColumn(
        'user_reliability',
        'role',
        {
          type: Sequelize.STRING(20),
          allowNull: false,
        },
        { transaction },
      );

      if (dialect === 'mysql') {
        const [pkRows] = await q.query(
          "SHOW INDEX FROM user_reliability WHERE Key_name = 'PRIMARY'",
          { transaction },
        );
        const primaryCols = pkRows.map((row) => row.Column_name);
        const hasCompositePrimaryKey =
          primaryCols.length === 2 &&
          primaryCols.includes('user_id') &&
          primaryCols.includes('role');

        if (!hasCompositePrimaryKey) {
          try {
            await q.query('ALTER TABLE user_reliability DROP PRIMARY KEY', { transaction });
            await q.query('ALTER TABLE user_reliability ADD PRIMARY KEY (user_id, role)', { transaction });
          } catch (err) {
            const message = err?.message || String(err);
            // Some environments already have FKs targeting user_reliability.user_id.
            // In that case MySQL prevents dropping PRIMARY; keep current PK so migration chain can proceed.
            if (!/Cannot drop index 'PRIMARY': needed in a foreign key constraint/i.test(message)) {
              throw err;
            }
          }
        }
      } else {
        await q.query(
          `DO $$
           BEGIN
             IF NOT EXISTS (
               SELECT 1
               FROM pg_constraint c
               JOIN pg_class t ON c.conrelid = t.oid
               WHERE t.relname = 'user_reliability'
                 AND c.contype = 'p'
                 AND c.conkey::text = (
                   SELECT ARRAY[
                     (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'user_id'),
                     (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'role')
                   ]::text
                 )
             ) THEN
               ALTER TABLE user_reliability DROP CONSTRAINT user_reliability_pkey;
               ALTER TABLE user_reliability ADD PRIMARY KEY (user_id, role);
             END IF;
           END
           $$;`,
          { transaction },
        );
      }
    });
  },

  async down(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    const dialect = q.getDialect();

    if (dialect !== 'mysql' && dialect !== 'postgres') {
      return;
    }

    await q.transaction(async (transaction) => {
      if (dialect === 'mysql') {
        await q.query('ALTER TABLE user_reliability DROP PRIMARY KEY', { transaction });
      } else {
        await q.query('ALTER TABLE user_reliability DROP CONSTRAINT user_reliability_pkey', { transaction });
      }

      await q.query(
        `DELETE FROM user_reliability WHERE role = 'student'
         AND user_id IN (
           SELECT user_id FROM user_reliability WHERE role = 'coach'
         )`,
        { transaction },
      );

      await queryInterface.removeColumn('user_reliability', 'role', { transaction });

      await q.query('ALTER TABLE user_reliability ADD PRIMARY KEY (user_id)', { transaction });
    });
  },
};
