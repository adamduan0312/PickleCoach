import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const WebhookLog = sequelize.define('webhook_logs', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  provider: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  event_type: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  event_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  processed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  success: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  response: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'webhook_logs',
  timestamps: true,
  createdAt: 'received_at',
  updatedAt: false,
  indexes: [
    { fields: ['provider'] },
    { fields: ['event_type'] },
    { fields: ['received_at'] },
    { unique: true, fields: ['provider', 'event_id'] },
    { fields: ['provider', 'event_type', 'received_at'] },
  ],
});

export default WebhookLog;
