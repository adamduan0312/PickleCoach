'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payment_actions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'payments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      dispute_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'disputes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action_type: {
        type: Sequelize.ENUM('dispute_refund_full', 'dispute_refund_partial'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'succeeded', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      /** NULL for full refunds until worker snaps amount from Stripe charge. */
      refund_cents: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      /** NULL for full refunds until worker derives stable idempotency key (includes cents). */
      idempotency_key: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
      },
      stripe_refund_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('payment_actions', ['status', 'id'], { name: 'payment_actions_status_id' });
    await queryInterface.addIndex('payment_actions', ['dispute_id'], { name: 'payment_actions_dispute_id' });
    await queryInterface.addIndex('payment_actions', ['booking_id'], { name: 'payment_actions_booking_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_actions');
  },
};
