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
    type: DataTypes.ENUM(
      'pending',
      'confirmed',
      'awaiting_verification',
      'completed',
      'cancelled',
      'disputed',
      'student_no_show',
      'coach_no_show'
    ),
    defaultValue: 'pending',
  },
  payout_status: {
    type: DataTypes.ENUM('none', 'pending', 'awaiting_verification', 'processing', 'paid', 'forfeited'),
    defaultValue: 'none',
  },
  /**
   * Locks attendance outcome mutations outside dispute adjudication.
   *
   * Once true:
   * - coach/admin no-show endpoints are blocked (409 `attendance_finalized_locked`)
   * - attendance outcome may only change through a NEW dispute resolution
   *
   * This does NOT mean the booking row can never change again in any way —
   * it does NOT freeze unrelated booking fields. It means the attendance
   * outcome (`bookings.status` when it reflects attendance: `student_no_show`,
   * `coach_no_show`, or post-lesson outcomes governed by disputes) cannot be
   * mutated outside the dispute adjudication flow.
   *
   * Set exclusively by `PUT /api/disputes/:id/resolve` after any dispute
   * resolution (attendance claims and behavior types: `misconduct`,
   * `late_arrival`, `lesson_not_completed`). Behavior resolutions also set
   * this flag intentionally: dispute resolution is the authoritative
   * adjudication boundary for the booking incident.
   */
  attendance_finalized: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  cancelled_by: {
    type: DataTypes.ENUM('student', 'coach', 'admin', 'system'),
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
  declined_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  decline_message_to_student: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  decline_reason_code: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  idempotency_key: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'bookings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  validate: {
    coachNotSameAsStudent() {
      if (this.primary_student_id != null && this.coach_id === this.primary_student_id) {
        throw new Error('Coach and student must be different users.');
      }
    },
  },
  indexes: [
    { fields: ['coach_id'] },
    { fields: ['primary_student_id'] },
    { fields: ['scheduled_at'] },
    { fields: ['status'] },
    { fields: ['payout_status'] },
    { fields: ['court_location_id'] },
    { fields: ['coach_id', 'status', 'scheduled_at'] },
    { fields: ['primary_student_id', 'status', 'scheduled_at'] },
    { fields: ['primary_student_id', 'idempotency_key'], unique: true, name: 'bookings_student_idempotency_unique' },
  ],
});

export default Booking;
