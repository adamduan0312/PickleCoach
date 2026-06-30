import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Conversation = sequelize.define('conversations', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
}, {
  tableName: 'conversations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['booking_id'] },
  ],
});

export default Conversation;
