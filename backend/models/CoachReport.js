import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CoachReport = sequelize.define('coach_reports', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  total_earnings: {
    type: DataTypes.DECIMAL(14, 2),
    defaultValue: 0,
  },
  total_lessons: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  average_rating: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 0,
  },
  feedback_summary: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  report_month: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
}, {
  tableName: 'coach_reports',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['report_month'] },
  ],
});

export default CoachReport;
