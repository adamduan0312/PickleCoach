import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const SessionHistory = sequelize.define('session_history', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'session_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['booking_id'] },
    { fields: ['student_id'] },
    { fields: ['coach_id'] },
  ],
});

export default SessionHistory;
