'use strict';

/**
 * Enforce one review per booking at the database layer.
 * App already returns 409; UNIQUE(booking_id) closes race-condition gaps.
 */
module.exports = {
  async up(queryInterface) {
    const indexes = await queryInterface.showIndex('reviews');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));

    // Prefer unique index; MySQL FK on booking_id can use it.
    if (!names.has('reviews_booking_id_unique')) {
      await queryInterface.addIndex('reviews', ['booking_id'], {
        unique: true,
        name: 'reviews_booking_id_unique',
      });
    }

    // Drop legacy non-unique KEY `booking_id` if still present (name may equal column).
    const remaining = await queryInterface.showIndex('reviews');
    for (const idx of remaining) {
      const name = idx.name || idx.Key_name;
      const unique = idx.unique === true || idx.Non_unique === 0;
      const cols = [].concat(idx.fields || idx.Column_name || []);
      const fieldNames = cols.map((c) => (typeof c === 'string' ? c : c.attribute || c.column || c));
      if (name === 'booking_id' && !unique && fieldNames.includes('booking_id')) {
        await queryInterface.removeIndex('reviews', 'booking_id');
      }
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('reviews');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));

    if (names.has('reviews_booking_id_unique')) {
      await queryInterface.removeIndex('reviews', 'reviews_booking_id_unique');
    }

    // Restore non-unique index for FK support if needed.
    const after = await queryInterface.showIndex('reviews');
    const afterNames = new Set(after.map((i) => i.name || i.Key_name));
    const hasBookingIndex = [...after].some((i) => {
      const cols = [].concat(i.fields || i.Column_name || []);
      const fieldNames = cols.map((c) => (typeof c === 'string' ? c : c.attribute || c.column || c));
      return fieldNames.includes('booking_id');
    });
    if (!hasBookingIndex && !afterNames.has('booking_id')) {
      await queryInterface.addIndex('reviews', ['booking_id'], { name: 'booking_id' });
    }
  },
};
