import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const SystemJob = sequelize.define('system_jobs', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  job_type: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  related_booking_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed'),
    defaultValue: 'pending',
  },
  scheduled_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  attempted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  last_error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  retries: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  tableName: 'system_jobs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['status'] },
    { fields: ['scheduled_at'] },
    { fields: ['job_type'] },
    { fields: ['related_booking_id'] },
  ],
});

export default SystemJob;
