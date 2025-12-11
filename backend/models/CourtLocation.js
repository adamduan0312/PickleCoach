import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const CourtLocation = sequelize.define('court_locations', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  address: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  latitude: {
    type: DataTypes.DOUBLE,
    allowNull: true,
  },
  longitude: {
    type: DataTypes.DOUBLE,
    allowNull: true,
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_private: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  created_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  source: {
    type: DataTypes.ENUM('manual', 'import', 'api'),
    defaultValue: 'manual',
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'court_locations',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['latitude'] },
    { fields: ['longitude'] },
    { fields: ['name', 'address'], unique: true, name: 'unique_court' },
  ],
});

export default CourtLocation;

