'use strict';

/** Admin alerts API removed for MVP; table unused. */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('admin_alerts');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_alerts', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      alert_type: {
        type: Sequelize.ENUM('no_show', 'pending_dispute', 'failed_payout', 'webhook_failure', 'other'),
        allowNull: false,
      },
      related_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      related_booking_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      related_payment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'payments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'critical'),
        defaultValue: 'warning',
      },
      resolved: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('admin_alerts', ['alert_type'], { name: 'admin_alerts_alert_type' });
    await queryInterface.addIndex('admin_alerts', ['resolved'], { name: 'admin_alerts_resolved' });
    await queryInterface.addIndex('admin_alerts', ['created_at'], { name: 'admin_alerts_created_at' });
  },
};
