'use strict';

/** Remove reschedule system: table, booking counters, reliability reschedule metrics. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.dropTable('reschedule_history');

    for (const col of [
      'reschedule_count',
      'reschedule_limit',
      'extra_paid_reschedules',
      'reschedule_deadline',
    ]) {
      await queryInterface.removeColumn('bookings', col);
    }

    for (const col of [
      'penalized_reschedules_recent',
      'penalized_reschedules_decayed',
      'penalized_reschedules_total',
      'paid_reschedules',
    ]) {
      await queryInterface.removeColumn('user_reliability', col);
    }

    await queryInterface.sequelize.query(
      `UPDATE cancellation_history SET reason = 'other' WHERE reason = 'travel_delay'`,
    );

    await queryInterface.changeColumn('cancellation_history', 'reason', {
      type: Sequelize.ENUM(
        'weather',
        'emergency',
        'sickness',
        'schedule_conflict',
        'forgot',
        'other',
      ),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('cancellation_history', 'reason', {
      type: Sequelize.ENUM(
        'weather',
        'emergency',
        'sickness',
        'travel_delay',
        'schedule_conflict',
        'forgot',
        'other',
      ),
      allowNull: true,
    });

    for (const col of [
      'paid_reschedules',
      'penalized_reschedules_total',
      'penalized_reschedules_decayed',
      'penalized_reschedules_recent',
    ]) {
      const def =
        col === 'paid_reschedules' || col.endsWith('_recent')
          ? { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
          : { type: Sequelize.DECIMAL(20, 10), allowNull: false, defaultValue: 0 };
      await queryInterface.addColumn('user_reliability', col, def);
    }

    await queryInterface.addColumn('bookings', 'reschedule_deadline', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('bookings', 'extra_paid_reschedules', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('bookings', 'reschedule_limit', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await queryInterface.addColumn('bookings', 'reschedule_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.createTable('reschedule_history', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      booking_id: { type: Sequelize.INTEGER, allowNull: false },
      requested_by: {
        type: Sequelize.ENUM('student', 'coach', 'admin', 'system'),
        allowNull: false,
      },
      old_scheduled_at: { type: Sequelize.DATE, allowNull: false },
      new_scheduled_at: { type: Sequelize.DATE, allowNull: false },
      approved_by: { type: Sequelize.INTEGER, allowNull: true },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      approval_status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'auto_approved'),
        defaultValue: 'pending',
      },
      reason: {
        type: Sequelize.ENUM(
          'weather',
          'emergency',
          'sickness',
          'travel_delay',
          'schedule_conflict',
          'forgot',
          'other',
        ),
        allowNull: true,
      },
      reason_notes: { type: Sequelize.STRING(255), allowNull: true },
      affects_reliability: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      paid_reschedule: { type: Sequelize.BOOLEAN, defaultValue: false },
      transaction_id: { type: Sequelize.INTEGER, allowNull: true },
      admin_override: { type: Sequelize.BOOLEAN, defaultValue: false },
      requested_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },
};
