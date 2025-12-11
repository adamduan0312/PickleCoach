import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Message = sequelize.define('messages', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  sender_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  receiver_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  attachments: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'messages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['conversation_id'] },
    { fields: ['sender_id'] },
    { fields: ['receiver_id'] },
  ],
});

export default Message;
