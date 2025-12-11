import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const UserBadge = sequelize.define('user_badges', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  badge_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'user_badges',
  timestamps: true,
  createdAt: 'awarded_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['badge_key'] },
  ],
});

export default UserBadge;
