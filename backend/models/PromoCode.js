import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const PromoCode = sequelize.define('promo_codes', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  discount_percent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
  },
  discount_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  max_uses: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  uses: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'promo_codes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['code'] },
    { fields: ['expires_at'] },
  ],
});

export default PromoCode;
