'use strict';

/**
 * Local Stripe Connect readiness for marketplace discovery (DB-only filters).
 * Synced from Stripe on status checks / account.updated webhooks — never live Stripe calls in GET /coaches.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('coach_profiles', 'stripe_ready', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('coach_profiles', 'stripe_onboarding_completed_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('coach_profiles', ['stripe_ready'], {
      name: 'coach_profiles_stripe_ready',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('coach_profiles', 'coach_profiles_stripe_ready').catch(() => {});
    await queryInterface.removeColumn('coach_profiles', 'stripe_onboarding_completed_at');
    await queryInterface.removeColumn('coach_profiles', 'stripe_ready');
  },
};
