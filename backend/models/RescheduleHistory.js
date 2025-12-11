import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const RescheduleHistory = sequelize.define('reschedule_history', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  requested_by: {
    type: DataTypes.ENUM('student', 'coach', 'admin', 'system'),
    allowNull: false,
  },
  old_scheduled_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  new_scheduled_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  approval_status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'auto_approved'),
    defaultValue: 'pending',
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  paid_reschedule: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  transaction_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  admin_override: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'reschedule_history',
  timestamps: true,
  createdAt: 'requested_at',
  updatedAt: false,
  indexes: [
    { fields: ['booking_id'] },
    { fields: ['requested_by'] },
    { fields: ['requested_at'] },
    { fields: ['paid_reschedule'] },
    { fields: ['booking_id', 'requested_at'] },
  ],
});

export default RescheduleHistory;
