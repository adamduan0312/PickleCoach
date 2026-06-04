import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const Lesson = sequelize.define('lessons', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  /** USD/hr implied by this lesson’s total price and duration (not stored; for display/API only). */
  effective_hourly_rate: {
    type: DataTypes.VIRTUAL(DataTypes.DECIMAL(10, 2), ['price', 'duration_minutes']),
    get() {
      const price = Number(this.getDataValue('price'));
      const mins = Number(this.getDataValue('duration_minutes'));
      if (!Number.isFinite(price) || !Number.isFinite(mins) || mins <= 0) return null;
      return Math.round((price / (mins / 60)) * 100) / 100;
    },
  },
  max_students: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'lessons',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['coach_id', 'is_active'] },
    { fields: ['price'] },
  ],
});

export default Lesson;
