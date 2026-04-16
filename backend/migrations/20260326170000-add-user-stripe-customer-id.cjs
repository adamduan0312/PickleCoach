'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'stripe_customer_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addIndex('users', ['stripe_customer_id'], {
      unique: true,
      name: 'users_stripe_customer_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_stripe_customer_id');
    await queryInterface.removeColumn('users', 'stripe_customer_id');
  },
};
