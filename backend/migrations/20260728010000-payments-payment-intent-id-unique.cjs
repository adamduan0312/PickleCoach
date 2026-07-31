'use strict';

/**
 * Enforce one Payment row per Stripe PaymentIntent.
 * MySQL unique indexes allow multiple NULLs, so legacy rows without a PI remain valid.
 *
 * Drops the non-unique `payments_payment_intent_id` index if present, then adds
 * `payments_payment_intent_id_unique`.
 */

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName);
  return indexes.some((idx) => idx.name === indexName);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    if (await indexExists(queryInterface, 'payments', 'payments_payment_intent_id')) {
      await queryInterface.removeIndex('payments', 'payments_payment_intent_id');
    }
    if (!(await indexExists(queryInterface, 'payments', 'payments_payment_intent_id_unique'))) {
      await queryInterface.addIndex('payments', ['payment_intent_id'], {
        unique: true,
        name: 'payments_payment_intent_id_unique',
      });
    }
  },

  async down(queryInterface) {
    if (await indexExists(queryInterface, 'payments', 'payments_payment_intent_id_unique')) {
      await queryInterface.removeIndex('payments', 'payments_payment_intent_id_unique');
    }
    if (!(await indexExists(queryInterface, 'payments', 'payments_payment_intent_id'))) {
      await queryInterface.addIndex('payments', ['payment_intent_id'], {
        name: 'payments_payment_intent_id',
      });
    }
  },
};
