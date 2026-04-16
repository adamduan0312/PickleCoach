import { Model, DataTypes } from 'sequelize';

class User extends Model {
  static initModel(sequelize) {
    User.init(
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        full_name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        email: {
          type: DataTypes.STRING(150),
          allowNull: false,
          unique: true,
        },
      token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
        password_hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        avatar_url: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(30),
          allowNull: true,
        },
        phone_verified: {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
        },
        timezone: {
          type: DataTypes.STRING(50),
          allowNull: false,
          defaultValue: 'UTC',
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
        last_login: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        password_reset_token: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        password_reset_expires: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      email_verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      email_verification_token: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      email_verification_expires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      email_change_token: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      email_change_expires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      email_change_new_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      stripe_customer_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      },
      {
        sequelize,
        modelName: 'User',
        tableName: 'users',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
          { fields: ['is_active'] },
          { fields: ['deleted_at'] },
          { fields: ['email'], unique: true },
          { fields: ['password_reset_token'] },
          { fields: ['email_verification_token'] },
          { fields: ['email_change_token'] },
          { fields: ['stripe_customer_id'], unique: true },
        ],
      }
    );

    return User;
  }
}

export default User;

