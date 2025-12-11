import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CancellationHistory = sequelize.define('cancellation_history', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  cancelled_by: {
    type: DataTypes.ENUM('student', 'coach', 'admin', 'system'),
    allowNull: false,
  },
  refund_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  penalty_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  penalty_reason: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  refund_payment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'cancellation_history',
  timestamps: true,
  createdAt: 'cancelled_at',
  updatedAt: false,
  indexes: [
    { fields: ['booking_id'] },
    { fields: ['cancelled_at'] },
    { fields: ['booking_id', 'cancelled_at'] },
  ],
});

export default CancellationHistory;
