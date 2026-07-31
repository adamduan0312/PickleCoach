'use strict';

/**
 * MVP reviews are always public; the app no longer reads or writes visibility.
 * Drop the unused column so model, API, and DB match.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('reviews', 'visibility');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('reviews', 'visibility', {
      type: Sequelize.ENUM('public', 'private', 'semi_public'),
      defaultValue: 'public',
    });
  },
};
