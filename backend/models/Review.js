import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Review = sequelize.define('reviews', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  reviewer_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  target_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 5,
    },
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  attendance_badges: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  visibility: {
    type: DataTypes.ENUM('public', 'private', 'semi_public'),
    defaultValue: 'public',
  },
}, {
  tableName: 'reviews',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['target_user_id'] },
    { fields: ['reviewer_id'] },
    { fields: ['target_user_id', 'created_at'] },
  ],
});

export default Review;
