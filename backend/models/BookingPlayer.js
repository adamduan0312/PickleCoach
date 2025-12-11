import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const BookingPlayer = sequelize.define('booking_players', {
  booking_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
  },
  player_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
  },
}, {
  tableName: 'booking_players',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['player_id'] },
  ],
});

export default BookingPlayer;
