'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('payment_actions', 'stripe_idempotency_key', {
      type: Sequelize.STRING(255),
      allowNull: true,
      unique: true,
    });

    await queryInterface.sequelize.query(
      `UPDATE payment_actions SET stripe_idempotency_key = idempotency_key WHERE idempotency_key IS NOT NULL AND stripe_idempotency_key IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('payment_actions', 'stripe_idempotency_key');
  },
};
