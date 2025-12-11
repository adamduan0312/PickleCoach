import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Payout = sequelize.define('payouts', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  payment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'USD',
  },
  payout_method: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'failed'),
    defaultValue: 'pending',
  },
  external_payout_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  processed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'payouts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['payment_id'] },
  ],
});

export default Payout;
