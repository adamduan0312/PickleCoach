import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const AuditLog = sequelize.define('audit_logs', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  table_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  record_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  before_state: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  after_state: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
}, {
  tableName: 'audit_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['action'] },
    { fields: ['created_at'] },
  ],
});

export default AuditLog;
