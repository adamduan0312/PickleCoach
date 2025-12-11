import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const MessageTemplate = sequelize.define('message_templates', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  owner_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  title: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  body: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
}, {
  tableName: 'message_templates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

export default MessageTemplate;
