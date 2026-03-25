import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const UserRole = sequelize.define('user_roles', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  role: {
    type: DataTypes.ENUM('student', 'coach', 'admin'),
    allowNull: false,
  },
}, {
  tableName: 'user_roles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { unique: true, fields: ['user_id', 'role'], name: 'user_roles_user_id_role_unique' },
  ],
});

export default UserRole;
