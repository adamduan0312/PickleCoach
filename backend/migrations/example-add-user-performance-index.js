'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Example: Add composite index on role and is_active
    // This improves performance for queries like:
    // - "Get all active coaches"
    // - "Get all active students"
    // - "Get all inactive users by role"
    await queryInterface.addIndex('users', ['role', 'is_active'], {
      name: 'idx_users_role_active',
      // Optional: Add a comment to document why this index exists
      // comment: 'Composite index for filtering users by role and active status'
    });

    // Example 2: Add index on last_login for sorting active users
    // This improves performance for queries like:
    // - "Get users sorted by last login"
    // - "Get recently active users"
    await queryInterface.addIndex('users', ['last_login'], {
      name: 'idx_users_last_login',
      // Only index non-null values (useful if many users haven't logged in yet)
      where: {
        last_login: {
          [Sequelize.Op.ne]: null
        }
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove indexes in reverse order
    await queryInterface.removeIndex('users', 'idx_users_last_login');
    await queryInterface.removeIndex('users', 'idx_users_role_active');
  }
};
