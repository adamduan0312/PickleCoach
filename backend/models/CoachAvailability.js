import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CoachAvailability = sequelize.define('coach_availabilities', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  weekday: {
    type: DataTypes.TINYINT,
    allowNull: true,
  },
  start_datetime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  end_datetime: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  /** Time-of-day only (e.g. "09:00:00", "17:00:00") for recurring weekly slots. Interpreted in coach timezone. */
  start_time: {
    type: DataTypes.STRING(8),
    allowNull: true,
  },
  /** Time-of-day only (e.g. "17:00:00") for recurring weekly slots. Interpreted in coach timezone. */
  end_time: {
    type: DataTypes.STRING(8),
    allowNull: true,
  },
}, {
  tableName: 'coach_availabilities',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['weekday'] },
    { fields: ['start_date'] },
    { fields: ['end_date'] },
  ],
});

export default CoachAvailability;
