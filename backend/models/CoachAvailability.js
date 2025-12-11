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
  start_time: {
    type: DataTypes.TIME,
    allowNull: true,
  },
  end_time: {
    type: DataTypes.TIME,
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
  recurrence_rule: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  is_available: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
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
