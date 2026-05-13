'use strict';

/**
 * Replace categorical skill_level with self-reported numeric skill_rating (2.0–6.0, 0.5 steps)
 * and optional rating_system (default self).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex('coach_profiles', 'coach_profiles_skill_location_rating').catch(() => {});

    await queryInterface.addColumn('coach_profiles', 'skill_rating', {
      type: Sequelize.DECIMAL(3, 1),
      allowNull: true,
    });

    await queryInterface.addColumn('coach_profiles', 'rating_system', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'self',
    });

    await queryInterface.sequelize.query(`
      UPDATE coach_profiles
      SET
        skill_rating = CASE skill_level
          WHEN 'beginner' THEN 3.0
          WHEN 'intermediate' THEN 3.5
          WHEN 'advanced' THEN 4.5
          WHEN 'pro' THEN 5.5
          ELSE NULL
        END,
        rating_system = 'self'
      WHERE skill_level IS NOT NULL
    `);

    await queryInterface.removeColumn('coach_profiles', 'skill_level');

    await queryInterface.addIndex('coach_profiles', ['skill_rating', 'location', 'rating_average'], {
      name: 'coach_profiles_skill_rating_location_rating',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('coach_profiles', 'coach_profiles_skill_rating_location_rating').catch(() => {});

    await queryInterface.addColumn('coach_profiles', 'skill_level', {
      type: Sequelize.ENUM('beginner', 'intermediate', 'advanced', 'pro'),
      allowNull: false,
      defaultValue: 'intermediate',
    });

    await queryInterface.sequelize.query(`
      UPDATE coach_profiles
      SET skill_level = CASE
        WHEN skill_rating IS NULL THEN 'intermediate'
        WHEN skill_rating < 3.25 THEN 'beginner'
        WHEN skill_rating < 4.0 THEN 'intermediate'
        WHEN skill_rating < 5.0 THEN 'advanced'
        ELSE 'pro'
      END
    `);

    await queryInterface.removeColumn('coach_profiles', 'skill_rating');
    await queryInterface.removeColumn('coach_profiles', 'rating_system');

    await queryInterface.addIndex('coach_profiles', ['skill_level', 'location', 'rating_average'], {
      name: 'coach_profiles_skill_location_rating',
    });
  },
};
