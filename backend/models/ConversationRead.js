import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

/**
 * Per-user read cursor for a conversation.
 * Unread = messages from others with created_at > last_read_at (or all incoming if no row).
 */
const ConversationRead = sequelize.define('conversation_reads', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  last_read_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  tableName: 'conversation_reads',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'], name: 'conversation_reads_conversation_user_unique' },
    { fields: ['user_id'], name: 'conversation_reads_user_id' },
  ],
});

export default ConversationRead;
