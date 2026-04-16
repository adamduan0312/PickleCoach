'use strict';

/** Stripe dispute mirror fields + in-app dispute Stripe linkage */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE payments ADD COLUMN stripe_dispute_id VARCHAR(255) NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE payments ADD COLUMN stripe_dispute_status VARCHAR(64) NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE disputes ADD COLUMN stripe_dispute_id VARCHAR(255) NULL`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE disputes ADD COLUMN stripe_dispute_status VARCHAR(64) NULL`
    );
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX disputes_stripe_dispute_id_unique ON disputes (stripe_dispute_id)
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX disputes_stripe_dispute_id_unique ON disputes`);
    await queryInterface.sequelize.query(`ALTER TABLE disputes DROP COLUMN stripe_dispute_status`);
    await queryInterface.sequelize.query(`ALTER TABLE disputes DROP COLUMN stripe_dispute_id`);
    await queryInterface.sequelize.query(`ALTER TABLE payments DROP COLUMN stripe_dispute_status`);
    await queryInterface.sequelize.query(`ALTER TABLE payments DROP COLUMN stripe_dispute_id`);
  },
};
