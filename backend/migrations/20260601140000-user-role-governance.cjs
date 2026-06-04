'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.role_governance_locked) {
      await queryInterface.addColumn('users', 'role_governance_locked', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    if (!table.admin_allowed_roles) {
      await queryInterface.addColumn('users', 'admin_allowed_roles', {
        type: Sequelize.JSON,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.admin_allowed_roles) {
      await queryInterface.removeColumn('users', 'admin_allowed_roles');
    }
    if (table.role_governance_locked) {
      await queryInterface.removeColumn('users', 'role_governance_locked');
    }
  },
};
