import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

const PaymentAction = sequelize.define(
  'payment_action',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    booking_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    payment_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    dispute_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    action_type: {
      type: DataTypes.ENUM(
        'dispute_refund_full',
        'dispute_refund_partial',
        'booking_cancel_refund',
        'booking_coach_no_show_refund',
        'booking_admin_refund',
      ),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'succeeded', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    refund_cents: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    idempotency_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
    },
    /** Canonical Stripe refund idempotency key (replay-safe); mirrors `idempotency_key` for new rows. */
    stripe_idempotency_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
    },
    stripe_refund_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'payment_actions',
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default PaymentAction;
