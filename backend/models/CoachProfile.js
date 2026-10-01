import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CoachProfile = sequelize.define('coach_profiles', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  headline: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  experience_years: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  /** Self-reported pickleball numeric level (standard-style scale), 2.0–6.0 in 0.5 steps; nullable until set. */
  /** DUPR (3 dp) or UTR-P (1 dp) — rules in utils/coachRating.js. Never compared across systems. */
  skill_rating: {
    type: DataTypes.DECIMAL(5, 3),
    allowNull: true,
  },
  /** 'DUPR' | 'UTR-P' | null. Required whenever skill_rating is set. Not verified against external APIs. */
  rating_system: {
    type: DataTypes.STRING(32),
    allowNull: true,
    defaultValue: null,
  },
  /** JSON array of certification names, or null when none. */
  certifications: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  location: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  rating_average: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 0,
  },
  rating_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  coach_commission_percent: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 92.00,
  },
  stripe_account_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  /**
   * Local cache: Stripe Connect can receive payouts (synced via status endpoint / account.updated).
   * Used by GET /api/coaches — never call Stripe per coach in discovery.
   */
  stripe_ready: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  stripe_onboarding_completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'coach_profiles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['skill_rating', 'location', 'rating_average'] },
    { fields: ['stripe_account_id'] },
    { fields: ['stripe_ready'] },
  ],
});

export default CoachProfile;
