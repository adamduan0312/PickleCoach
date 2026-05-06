'use strict';

/**
 * Add explicit student_no_show booking status.
 * Keep legacy no_show for backward compatibility with existing rows/clients.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_bookings_status" ADD VALUE IF NOT EXISTS 'student_no_show';`
      );
      return;
    }

    if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryInterface.changeColumn('bookings', 'status', {
        type: Sequelize.ENUM(
          'pending',
          'confirmed',
          'awaiting_verification',
          'completed',
          'cancelled',
          'disputed',
          'student_no_show',
          'no_show',
          'coach_no_show'
        ),
        allowNull: false,
        defaultValue: 'pending',
      });
      return;
    }

    // Fallback for other dialects
    await queryInterface.changeColumn('bookings', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
    });
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // Enum value removal is unsafe on Postgres/MySQL when data exists.
    // We intentionally keep the expanded enum during rollback.
    if (dialect === 'postgres' || dialect === 'mysql' || dialect === 'mariadb') {
      return;
    }

    await queryInterface.changeColumn('bookings', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
    });
  },
};
