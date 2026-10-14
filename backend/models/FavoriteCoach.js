import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

/** A student saving a coach to find them again. Not visible to the coach or to other students. */
const FavoriteCoach = sequelize.define('favorite_coach', {
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
}, {
  tableName: 'favorite_coaches',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['student_id', 'coach_id'] },
    { fields: ['coach_id'] },
  ],
});

export default FavoriteCoach;
