import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const DisputeResolutionAction = sequelize.define('dispute_resolution_actions', {
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
  affects_reliability_score: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  requires_payout_adjustment: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'dispute_resolution_actions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

export default DisputeResolutionAction;
