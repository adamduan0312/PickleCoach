'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create user_roles table
    await queryInterface.createTable('user_roles', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      role: {
        type: Sequelize.ENUM('student', 'coach', 'admin'),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('user_roles', ['user_id'], { name: 'user_roles_user_id' });
    await queryInterface.addIndex('user_roles', ['user_id', 'role'], {
      unique: true,
      name: 'user_roles_user_id_role_unique',
    });

    // 2. Migrate existing users.role into user_roles
    const [rows] = await queryInterface.sequelize.query(
      "SELECT id, role FROM users WHERE role IS NOT NULL AND role != ''"
    );
    if (rows && rows.length > 0) {
      const now = new Date();
      const bulk = rows.map((r) => ({
        user_id: r.id,
        role: r.role,
        created_at: now,
      }));
      await queryInterface.bulkInsert('user_roles', bulk);
    }

    // 3. Drop role column and its index from users
    try {
      await queryInterface.removeIndex('users', 'users_role');
    } catch (_) {}
    await queryInterface.removeColumn('users', 'role');
  },

  async down(queryInterface, Sequelize) {
    // 1. Add role column back to users
    await queryInterface.addColumn('users', 'role', {
      type: Sequelize.ENUM('student', 'coach', 'admin'),
      allowNull: false,
      defaultValue: 'student',
    });

    // 2. Restore one role per user (pick first from user_roles; prefer admin, then coach, then student)
    const [roleRows] = await queryInterface.sequelize.query(
      'SELECT user_id, role FROM user_roles ORDER BY user_id, FIELD(role, "admin", "coach", "student")'
    );
    const byUser = new Map();
    if (roleRows && roleRows.length > 0) {
      roleRows.forEach((r) => {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, r.role);
      });
      for (const [userId, role] of byUser) {
        await queryInterface.sequelize.query(
          'UPDATE users SET role = ? WHERE id = ?',
          { replacements: [role, userId] }
        );
      }
    }

    await queryInterface.addIndex('users', ['role'], { name: 'users_role' });

    // 3. Drop user_roles table
    await queryInterface.dropTable('user_roles');
  },
};
