import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

/** Coach gallery photo ("On the court"). Not the account avatar — see users.avatar_url. */
const CoachPhoto = sequelize.define('coach_photo', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  coach_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  /** Public path `/uploads/coach-photos/<filename>`. */
  url: {
    type: DataTypes.STRING(512),
    allowNull: false,
  },
  /** Gallery order; the lowest position is the cover (featured image). */
  position: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'coach_photos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [{ fields: ['coach_id', 'position'] }],
});

export default CoachPhoto;
