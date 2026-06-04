'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.email_verification_last_sent_at) {
      await queryInterface.addColumn('users', 'email_verification_last_sent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.email_verification_last_sent_at) {
      await queryInterface.removeColumn('users', 'email_verification_last_sent_at');
    }
  },
};
