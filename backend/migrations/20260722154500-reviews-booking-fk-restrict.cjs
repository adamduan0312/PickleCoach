'use strict';

/**
 * Reviews must outlive booking cancel/lifecycle. Bookings are cancelled in-app, not deleted.
 * CASCADE would silently wipe reviews (and coach rating history) on any hard delete
 * (e.g. seed resets). Match conversations.booking_id: RESTRICT.
 */
module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query('ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_ibfk_1`');
    } else {
      try {
        await queryInterface.removeConstraint('reviews', 'reviews_ibfk_1');
      } catch (_) {
        /* ignore */
      }
    }

    await queryInterface.addConstraint('reviews', {
      fields: ['booking_id'],
      type: 'foreign key',
      name: 'reviews_booking_id_fk',
      references: { table: 'bookings', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeConstraint('reviews', 'reviews_booking_id_fk');
    } catch (_) {
      /* ignore */
    }

    await queryInterface.addConstraint('reviews', {
      fields: ['booking_id'],
      type: 'foreign key',
      name: 'reviews_ibfk_1',
      references: { table: 'bookings', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },
};
