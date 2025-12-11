import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const DisputeType = sequelize.define('dispute_types', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  default_escalation_hours: {
    type: DataTypes.INTEGER,
    defaultValue: 48,
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high'),
    defaultValue: 'medium',
  },
}, {
  tableName: 'dispute_types',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

export default DisputeType;
