import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const PrebookingInquiry = sequelize.define('prebooking_inquiries', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  message: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  filtered: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  blocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'prebooking_inquiries',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['created_at'] },
    { unique: true, fields: ['student_id', 'coach_id'] },
  ],
});

export default PrebookingInquiry;
