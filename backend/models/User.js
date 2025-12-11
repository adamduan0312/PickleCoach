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
        password_hash: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        role: {
          type: DataTypes.ENUM('student', 'coach', 'admin'),
          allowNull: false,
          defaultValue: 'student',
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
        last_login: {
          type: DataTypes.DATE,
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
          { fields: ['role'] },
          { fields: ['is_active'] },
          { fields: ['email'], unique: true },
        ],
      }
    );

    return User;
  }
}

export default User;

