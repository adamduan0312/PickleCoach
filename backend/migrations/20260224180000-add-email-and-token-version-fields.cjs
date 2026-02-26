'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('users');

    // Token versioning for JWT revocation
    if (!tableDesc.token_version) {
      await queryInterface.addColumn('users', 'token_version', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    // Email verification fields
    if (!tableDesc.email_verified_at) {
      await queryInterface.addColumn('users', 'email_verified_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!tableDesc.email_verification_token) {
      await queryInterface.addColumn('users', 'email_verification_token', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }

    if (!tableDesc.email_verification_expires) {
      await queryInterface.addColumn('users', 'email_verification_expires', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    // Email change flow fields
    if (!tableDesc.email_change_token) {
      await queryInterface.addColumn('users', 'email_change_token', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }

    if (!tableDesc.email_change_expires) {
      await queryInterface.addColumn('users', 'email_change_expires', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    if (!tableDesc.email_change_new_email) {
      await queryInterface.addColumn('users', 'email_change_new_email', {
        type: Sequelize.STRING(150),
        allowNull: true,
      });
    }

    // Idempotent indexes for lookup by token
    const indexes = await queryInterface.showIndex('users');

    const hasEmailVerificationIdx = indexes.some((i) => (i.Key_name != null ? i.Key_name : i.name) === 'users_email_verification_token');
    if (!hasEmailVerificationIdx) {
      await queryInterface.addIndex('users', ['email_verification_token'], {
        name: 'users_email_verification_token',
      });
    }

    const hasEmailChangeIdx = indexes.some((i) => (i.Key_name != null ? i.Key_name : i.name) === 'users_email_change_token');
    if (!hasEmailChangeIdx) {
      await queryInterface.addIndex('users', ['email_change_token'], {
        name: 'users_email_change_token',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Remove indexes first
    await queryInterface.removeIndex('users', 'users_email_verification_token').catch(() => {});
    await queryInterface.removeIndex('users', 'users_email_change_token').catch(() => {});

    // Then remove columns (wrapped in try/catch to be defensive)
    const columns = [
      'email_change_new_email',
      'email_change_expires',
      'email_change_token',
      'email_verification_expires',
      'email_verification_token',
      'email_verified_at',
      'token_version',
    ];

    for (const col of columns) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeColumn('users', col).catch(() => {});
    }
  },
};

