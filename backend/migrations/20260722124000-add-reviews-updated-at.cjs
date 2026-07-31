'use strict';

/**
 * Reviews are editable (PUT /api/reviews/:id). Track last edit time separately from created_at.
 * Existing rows backfill updated_at = created_at (never edited, or edit time unknown).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reviews', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.sequelize.query(
      'UPDATE reviews SET updated_at = created_at WHERE updated_at IS NULL',
    );

    await queryInterface.changeColumn('reviews', 'updated_at', {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('reviews', 'updated_at');
  },
};
