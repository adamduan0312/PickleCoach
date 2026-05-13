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
  hourly_rate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  experience_years: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  /** Self-reported pickleball numeric level (standard-style scale), 2.0–6.0 in 0.5 steps; nullable until set. */
  skill_rating: {
    type: DataTypes.DECIMAL(3, 1),
    allowNull: true,
  },
  /** e.g. `self` (MVP; no DUPR/API verification). */
  rating_system: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'self',
  },
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
  ],
});

export default CoachProfile;
