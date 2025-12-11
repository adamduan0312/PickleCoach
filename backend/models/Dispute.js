import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Dispute = sequelize.define('disputes', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  dispute_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  opened_by: {
    type: DataTypes.ENUM('student', 'coach', 'system', 'admin'),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('open', 'under_review', 'resolved', 'rejected'),
    defaultValue: 'open',
  },
  resolution_action_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  resolution_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  escalated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  escalated_to: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  escalation_triggered_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'disputes',
  timestamps: true,
  createdAt: 'opened_at',
  updatedAt: false,
  indexes: [
    { fields: ['status'] },
    { fields: ['dispute_type_id'] },
    { fields: ['admin_id'] },
    { fields: ['escalated'] },
  ],
});

export default Dispute;
