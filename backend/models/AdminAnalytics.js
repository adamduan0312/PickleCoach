import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const AdminAnalytics = sequelize.define('admin_analytics', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  total_revenue: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  },
  total_commissions: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  },
  total_lessons: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  total_students: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  total_coaches: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  most_popular_lessons: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  top_rated_coaches: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'admin_analytics',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

export default AdminAnalytics;
