import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const decimal = (precision, scale) => DataTypes.DECIMAL(precision, scale);

/**
 * Canonical persisted reliability metrics (see `reliabilityEngine.js` and `docs/reliability-system.md`).
 * Primary key: (user_id, role).
 */
const UserReliability = sequelize.define('user_reliability', {
  user_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  role: {
    type: DataTypes.STRING(20),
    primaryKey: true,
    validate: {
      isIn: [['coach', 'student']],
    },
  },

  booking_baseline_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  booking_baseline_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  booking_baseline_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  total_bookings_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  late_cancels_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  late_cancels_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  late_cancels_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  coach_cancels_non_late_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  coach_cancels_non_late_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  coach_cancels_non_late_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  student_cancels_non_late_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  student_cancels_non_late_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  student_cancels_non_late_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  no_shows_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  no_shows_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  no_shows_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  misconduct_penalties_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  misconduct_penalties_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  misconduct_penalties_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  lesson_not_completed_penalties_recent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  lesson_not_completed_penalties_decayed: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },
  lesson_not_completed_penalties_total: { type: decimal(20, 10), allowNull: false, defaultValue: 0 },

  smoothing_k: { type: decimal(12, 6), allowNull: false, defaultValue: 5 },
  decay_lambda: { type: decimal(12, 6), allowNull: false, defaultValue: 0.03 },
  scoring_window_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 90 },
  last_recomputed_at: { type: DataTypes.DATE, allowNull: true },
  score_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  /** `computed` = row metrics match reliability_score; `admin_override` = manual score may diverge until next recompute. */
  score_source: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'computed',
  },
  reliability_reset_at: { type: DataTypes.DATE, allowNull: true },

  reliability_score: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 100.00,
  },
  badges: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'user_reliability',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'last_updated',
  indexes: [
    { fields: ['reliability_score'] },
  ],
});

export default UserReliability;
