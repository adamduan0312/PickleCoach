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
    allowNull: true,
  },
}, {
  tableName: 'conversations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['booking_id'] },
  ],
});

export default Conversation;
