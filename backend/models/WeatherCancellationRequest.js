import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const WeatherCancellationRequest = sequelize.define('weather_cancellation_request', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  requested_by_role: {
    type: DataTypes.ENUM('student', 'coach'),
    allowNull: false,
  },
  requested_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  note: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'accepted', 'declined', 'withdrawn', 'expired', 'closed'),
    allowNull: false,
    defaultValue: 'pending',
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  responded_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  responded_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  cancellation_history_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'weather_cancellation_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['booking_id', 'status'] },
    { unique: true, fields: ['booking_id', 'requested_by_role'], name: 'weather_cancel_one_request_per_role' },
  ],
});

export default WeatherCancellationRequest;
