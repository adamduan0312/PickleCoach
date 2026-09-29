'use strict';

/**
 * Snapshot the lesson title and selected court at booking time so later lesson /
 * court edits don't rewrite booking history. `court_location_id` stays as the link.
 *
 * Duration and price are already stored on bookings (duration_minutes, price).
 * Court address is stored as structured parts (not one formatted string) so the
 * private-court address redaction in courtAddressVisibility.js still applies.
 *
 * Nullable: rows without a snapshot fall back to the live lesson / court.
 * Existing bookings are backfilled from their lesson / court (best available history).
 */

const COLUMNS = (Sequelize) => [
  ['lesson_title_at_booking', { type: Sequelize.STRING(255), allowNull: true }],
  ['court_name_at_booking', { type: Sequelize.STRING(255), allowNull: true }],
  ['court_address_line1_at_booking', { type: Sequelize.STRING(255), allowNull: true }],
  ['court_city_at_booking', { type: Sequelize.STRING(100), allowNull: true }],
  ['court_state_at_booking', { type: Sequelize.STRING(2), allowNull: true }],
  ['court_postal_code_at_booking', { type: Sequelize.STRING(20), allowNull: true }],
  ['court_country_at_booking', { type: Sequelize.STRING(2), allowNull: true }],
  ['court_is_private_at_booking', { type: Sequelize.BOOLEAN, allowNull: true }],
  ['court_latitude_at_booking', { type: Sequelize.DOUBLE, allowNull: true }],
  ['court_longitude_at_booking', { type: Sequelize.DOUBLE, allowNull: true }],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      for (const [name, def] of COLUMNS(Sequelize)) {
        await queryInterface.addColumn('bookings', name, { ...def, defaultValue: null }, { transaction });
      }
      await queryInterface.sequelize.query(
        `UPDATE bookings b
           JOIN lessons l ON l.id = b.lesson_id
            SET b.lesson_title_at_booking = l.title`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE bookings b
           JOIN court_locations c ON c.id = b.court_location_id
            SET b.court_name_at_booking = c.name,
                b.court_address_line1_at_booking = c.address_line1,
                b.court_city_at_booking = c.city,
                b.court_state_at_booking = c.state,
                b.court_postal_code_at_booking = c.postal_code,
                b.court_country_at_booking = c.country,
                b.court_is_private_at_booking = c.is_private,
                b.court_latitude_at_booking = c.latitude,
                b.court_longitude_at_booking = c.longitude`,
        { transaction },
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      for (const [name] of COLUMNS(Sequelize).reverse()) {
        await queryInterface.removeColumn('bookings', name, { transaction });
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
