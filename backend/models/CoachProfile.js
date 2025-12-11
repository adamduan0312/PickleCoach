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
  skill_level: {
    type: DataTypes.ENUM('beginner', 'intermediate', 'advanced', 'pro'),
    defaultValue: 'intermediate',
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
}, {
  tableName: 'coach_profiles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['skill_level', 'location', 'rating_average'] },
  ],
});

export default CoachProfile;
