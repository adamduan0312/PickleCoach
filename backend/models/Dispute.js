import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Dispute = sequelize.define('disputes', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  booking_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  dispute_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  opened_by: {
    type: DataTypes.ENUM('student', 'coach', 'system', 'admin'),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('open', 'under_review', 'resolved', 'rejected'),
    defaultValue: 'open',
  },
  resolution_action_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  resolution_notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  decision: {
    type: DataTypes.ENUM('upheld', 'rejected', 'partial'),
    allowNull: true,
  },
  /**
   * Factual attendance result recorded at resolve time for attendance dispute
   * types (`coach_no_show_claim`, `student_no_show_claim`). Persisted on the
   * dispute so the determination survives subsequent admin overrides of
   * `bookings.status`. NULL for behavior disputes and unresolved disputes.
   */
  outcome: {
    type: DataTypes.ENUM('coach_no_show', 'student_no_show'),
    allowNull: true,
  },
  /**
   * Approved refund amount in integer cents. Populated at resolve time for
   * `refund_student_partial`. NULL for `refund_student` (full refund cents
   * are computed by the payment-action worker from the remaining Stripe
   * charge balance) and for `no_change`. Mirrors the
   * `payment_actions.refund_cents` convention.
   */
  refund_cents: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  penalize_role: {
    type: DataTypes.ENUM('coach', 'student', 'none'),
    allowNull: false,
    defaultValue: 'none',
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  escalated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  escalated_to: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  escalation_triggered_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  stripe_dispute_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    unique: true,
  },
  stripe_dispute_status: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
}, {
  tableName: 'disputes',
  timestamps: true,
  createdAt: 'opened_at',
  updatedAt: false,
  indexes: [
    { fields: ['status'] },
    { fields: ['dispute_type_id'] },
    { fields: ['decision'] },
    { fields: ['admin_id'] },
    { fields: ['escalated'] },
  ],
});

export default Dispute;
