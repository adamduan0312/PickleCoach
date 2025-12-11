import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CoachCourtLocation = sequelize.define('coach_court_locations', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  court_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  rate_modifier: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  preferred: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'coach_court_locations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['coach_id', 'court_id'], unique: true },
  ],
});

export default CoachCourtLocation;

