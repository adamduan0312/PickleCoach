import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const UserReliability = sequelize.define('user_reliability', {
  user_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  total_bookings: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  reschedules: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  paid_reschedules: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  late_cancels: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_shows: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  coach_cancels: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  reliability_score: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 100.00,
  },
  badges: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'user_reliability',
  timestamps: true,
  createdAt: false,
  updatedAt: 'last_updated',
  indexes: [
    { fields: ['reliability_score'] },
  ],
});

export default UserReliability;
