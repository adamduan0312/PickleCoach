import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Payment = sequelize.define('payments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  lesson_price: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  platform_fee_percent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 8.00,
  },
  platform_fee_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  total_charge_to_student: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  coach_payout_expected: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  escrow_status: {
    type: DataTypes.ENUM('held', 'released', 'refunded', 'disputed'),
    allowNull: false,
    defaultValue: 'held',
  },
  payment_status: {
    type: DataTypes.ENUM('pending', 'captured', 'failed', 'refunded'),
    defaultValue: 'pending',
  },
  payment_method: {
    type: DataTypes.ENUM('stripe', 'apple_pay', 'google_pay', 'card'),
    allowNull: false,
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'USD',
  },
  payment_intent_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  charge_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  transfer_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  payout_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  refunded_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
  },
  dispute_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'payments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['booking_id'] },
    { fields: ['student_id'] },
    { fields: ['coach_id'] },
    { fields: ['payment_intent_id'] },
    { fields: ['charge_id'] },
    { fields: ['escrow_status'] },
    { fields: ['created_at'] },
    { fields: ['escrow_status', 'created_at'] },
    { fields: ['student_id', 'escrow_status'] },
  ],
});

export default Payment;
