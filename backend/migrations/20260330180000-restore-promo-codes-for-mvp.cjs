'use strict';

/**
 * promo_codes kept for MVP (launch / marketing discounts).
 * Application of discounts at checkout is not wired yet — table + model are ready.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promo_codes'`,
    );
    if (rows.length > 0) return;

    await queryInterface.createTable('promo_codes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      discount_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
      },
      discount_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      max_uses: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      uses: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('promo_codes', ['expires_at'], { name: 'promo_codes_expires_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('promo_codes');
  },
};
