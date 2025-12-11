import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const AdminAlert = sequelize.define('admin_alerts', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  alert_type: {
    type: DataTypes.ENUM('no_show', 'pending_dispute', 'failed_payout', 'webhook_failure', 'other'),
    allowNull: false,
  },
  related_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  related_booking_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  related_payment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  severity: {
    type: DataTypes.ENUM('info', 'warning', 'critical'),
    defaultValue: 'warning',
  },
  resolved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'admin_alerts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['alert_type'] },
    { fields: ['resolved'] },
    { fields: ['created_at'] },
  ],
});

export default AdminAlert;
