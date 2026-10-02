'use strict';

/**
 * coach_profiles.experience_years: NULL means "not provided"; 0 is an explicit answer.
 *
 * Profile creation used to store a blank field as 0, so existing zeros can't be told apart
 * from "not provided". They are converted to NULL.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('coach_profiles', 'experience_years', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.sequelize.query('UPDATE coach_profiles SET experience_years = NULL WHERE experience_years = 0');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('UPDATE coach_profiles SET experience_years = 0 WHERE experience_years IS NULL');
    await queryInterface.changeColumn('coach_profiles', 'experience_years', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 0,
    });
  },
};
