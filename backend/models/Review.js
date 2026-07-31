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
    unique: true,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  coach_id: {
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
}, {
  tableName: 'reviews',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['booking_id'], name: 'reviews_booking_id_unique' },
    { fields: ['coach_id'] },
    { fields: ['student_id'] },
    { fields: ['coach_id', 'created_at'] },
  ],
});

export default Review;
