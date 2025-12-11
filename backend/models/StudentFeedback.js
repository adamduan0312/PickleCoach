import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const StudentFeedback = sequelize.define('student_feedback', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  student_id: {
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
  visibility: {
    type: DataTypes.ENUM('private', 'semi_public', 'public'),
    defaultValue: 'private',
  },
}, {
  tableName: 'student_feedback',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['student_id'] },
  ],
});

export default StudentFeedback;
