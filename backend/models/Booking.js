import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Booking = sequelize.define('bookings', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  lesson_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  primary_student_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  scheduled_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'awaiting_verification', 'completed', 'cancelled', 'disputed'),
    defaultValue: 'pending',
  },
  payout_status: {
    type: DataTypes.ENUM('none', 'pending', 'awaiting_verification', 'processing', 'paid', 'forfeited'),
    defaultValue: 'none',
  },
  cancelled_by: {
    type: DataTypes.ENUM('student', 'coach', 'admin'),
    allowNull: true,
  },
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  messaging_locked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  reschedule_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  reschedule_limit: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  extra_paid_reschedules: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  reschedule_deadline: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  court_location_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'bookings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['primary_student_id'] },
    { fields: ['scheduled_at'] },
    { fields: ['status'] },
    { fields: ['payout_status'] },
    { fields: ['court_location_id'] },
    { fields: ['coach_id', 'status', 'scheduled_at'] },
    { fields: ['primary_student_id', 'status', 'scheduled_at'] },
  ],
});

export default Booking;
