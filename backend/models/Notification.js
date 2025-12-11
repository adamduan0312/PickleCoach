import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Notification = sequelize.define('notifications', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  channel: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'failed'),
    allowNull: false,
    defaultValue: 'pending',
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'notifications',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
  ],
});

export default Notification;
