'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('users');
    if (!tableDesc.password_reset_token) {
      await queryInterface.addColumn('users', 'password_reset_token', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
    if (!tableDesc.password_reset_expires) {
      await queryInterface.addColumn('users', 'password_reset_expires', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // Add index for faster lookups (idempotent)
    const indexes = await queryInterface.showIndex('users');
    const hasIdx = indexes.some((i) => (i.Key_name != null ? i.Key_name : i.name) === 'users_password_reset_token');
    if (!hasIdx) {
      await queryInterface.addIndex('users', ['password_reset_token'], {
        name: 'users_password_reset_token',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'users_password_reset_token');
    await queryInterface.removeColumn('users', 'password_reset_expires');
    await queryInterface.removeColumn('users', 'password_reset_token');
  },
};
