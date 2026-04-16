'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mysql') {
      await queryInterface.changeColumn('bookings', 'cancelled_by', {
        type: Sequelize.ENUM('student', 'coach', 'admin', 'system'),
        allowNull: true,
      });
    } else if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE "enum_bookings_cancelled_by" ADD VALUE 'system';
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mysql') {
      await queryInterface.changeColumn('bookings', 'cancelled_by', {
        type: Sequelize.ENUM('student', 'coach', 'admin'),
        allowNull: true,
      });
    }
    // Postgres: removing enum value is awkward; leave 'system' in type on down
  },
};
