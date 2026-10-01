'use strict';

/**
 * Coach ratings become DUPR (2.000–8.000, 3 dp) or UTR-P (1.0–10.0, 1 dp) only.
 *
 * - skill_rating DECIMAL(3,1) → DECIMAL(5,3) (widening; existing values are preserved exactly).
 * - rating_system becomes nullable with no default (null = no rating).
 * - Self-reported ratings are cleared, not reinterpreted as DUPR/UTR-P:
 *   rows whose rating_system is not DUPR/UTR-P get skill_rating = NULL, rating_system = NULL.
 *   Existing DUPR/UTR-P values (previously 2.0–6.0 half steps) are valid on both new scales.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('coach_profiles', 'rating_system', {
      type: Sequelize.STRING(32),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.sequelize.query(`
      UPDATE coach_profiles
      SET skill_rating = NULL, rating_system = NULL
      WHERE rating_system IS NULL OR rating_system NOT IN ('DUPR', 'UTR-P')
    `);

    await queryInterface.changeColumn('coach_profiles', 'skill_rating', {
      type: Sequelize.DECIMAL(5, 3),
      allowNull: true,
    });
  },

  /**
   * Lossy by necessity: DECIMAL(3,1) cannot hold 3-decimal DUPR values (MySQL rounds 4.217 → 4.2),
   * and cleared self ratings cannot be restored.
   */
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('coach_profiles', 'skill_rating', {
      type: Sequelize.DECIMAL(3, 1),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE coach_profiles SET rating_system = 'self' WHERE rating_system IS NULL
    `);

    await queryInterface.changeColumn('coach_profiles', 'rating_system', {
      type: Sequelize.STRING(32),
      allowNull: false,
      defaultValue: 'self',
    });
  },
};
