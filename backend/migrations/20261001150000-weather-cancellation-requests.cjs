'use strict';

/**
 * Mutual weather cancellation: one participant asks, the other agrees → full refund, no reliability
 * impact. Declined / expired / withdrawn requests leave the normal cancellation rules in place.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('weather_cancellation_requests', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      booking_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'bookings', key: 'id' },
        onDelete: 'CASCADE',
      },
      requested_by_role: { type: Sequelize.ENUM('student', 'coach'), allowNull: false },
      requested_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      note: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.ENUM('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'closed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      responded_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      responded_at: { type: Sequelize.DATE, allowNull: true },
      cancellation_history_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'cancellation_history', key: 'id' },
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('weather_cancellation_requests', ['booking_id', 'status']);
    await queryInterface.addIndex('weather_cancellation_requests', ['booking_id', 'requested_by_role'], {
      unique: true,
      name: 'weather_cancel_one_request_per_role',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('weather_cancellation_requests');
  },
};
