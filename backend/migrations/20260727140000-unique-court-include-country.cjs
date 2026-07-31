'use strict';

/**
 * Expand unique_court to include country.
 *
 * MySQL InnoDB utf8mb4 max index key length is 3072 bytes. The prior composite
 * (255+255+100+50+20+100)*4 = 3120 exceeded that after adding country.
 * Shrink state/country to ISO alpha-2 (matches US-MVP validation) then add index.
 *
 * Note: a prior failed run may have already dropped `unique_court` — removeIndex
 * is best-effort so this migration is re-runnable.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex('court_locations', 'unique_court').catch(() => {});

    await queryInterface.changeColumn('court_locations', 'state', {
      type: Sequelize.STRING(2),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'country', {
      type: Sequelize.STRING(2),
      allowNull: false,
      defaultValue: 'US',
    });

    await queryInterface.addIndex(
      'court_locations',
      ['name', 'address_line1', 'city', 'state', 'postal_code', 'country'],
      { unique: true, name: 'unique_court' },
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('court_locations', 'unique_court').catch(() => {});

    await queryInterface.changeColumn('court_locations', 'state', {
      type: Sequelize.STRING(50),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'country', {
      type: Sequelize.STRING(100),
      allowNull: false,
      defaultValue: 'US',
    });

    await queryInterface.addIndex(
      'court_locations',
      ['name', 'address_line1', 'city', 'state', 'postal_code'],
      { unique: true, name: 'unique_court' },
    );
  },
};
