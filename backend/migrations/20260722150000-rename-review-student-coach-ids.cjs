'use strict';

/**
 * Domain rename: reviews are always student → coach.
 * reviewer_id → student_id, target_user_id → coach_id.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    // Drop FKs before rename (MySQL keeps old constraint names otherwise).
    if (dialect === 'mysql') {
      await queryInterface.sequelize.query('ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_ibfk_2`');
      await queryInterface.sequelize.query('ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_ibfk_3`');
    }

    await queryInterface.renameColumn('reviews', 'reviewer_id', 'student_id');
    await queryInterface.renameColumn('reviews', 'target_user_id', 'coach_id');

    // Rename indexes if they still use old names.
    const indexes = await queryInterface.showIndex('reviews');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));

    if (names.has('reviews_reviewer_id')) {
      await queryInterface.removeIndex('reviews', 'reviews_reviewer_id');
    }
    if (names.has('reviews_target_user_id')) {
      await queryInterface.removeIndex('reviews', 'reviews_target_user_id');
    }
    if (names.has('reviews_target_created')) {
      await queryInterface.removeIndex('reviews', 'reviews_target_created');
    }

    await queryInterface.addIndex('reviews', ['student_id'], { name: 'reviews_student_id' });
    await queryInterface.addIndex('reviews', ['coach_id'], { name: 'reviews_coach_id' });
    await queryInterface.addIndex('reviews', ['coach_id', 'created_at'], { name: 'reviews_coach_created' });

    await queryInterface.addConstraint('reviews', {
      fields: ['student_id'],
      type: 'foreign key',
      name: 'reviews_student_id_fk',
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addConstraint('reviews', {
      fields: ['coach_id'],
      type: 'foreign key',
      name: 'reviews_coach_id_fk',
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();

    try {
      await queryInterface.removeConstraint('reviews', 'reviews_student_id_fk');
    } catch (_) { /* ignore */ }
    try {
      await queryInterface.removeConstraint('reviews', 'reviews_coach_id_fk');
    } catch (_) { /* ignore */ }

    if (dialect === 'mysql') {
      // In case constraints were auto-named
      try {
        await queryInterface.sequelize.query('ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_student_id_fk`');
      } catch (_) { /* ignore */ }
      try {
        await queryInterface.sequelize.query('ALTER TABLE `reviews` DROP FOREIGN KEY `reviews_coach_id_fk`');
      } catch (_) { /* ignore */ }
    }

    const indexes = await queryInterface.showIndex('reviews');
    const names = new Set(indexes.map((i) => i.name || i.Key_name));
    for (const name of ['reviews_student_id', 'reviews_coach_id', 'reviews_coach_created']) {
      if (names.has(name)) await queryInterface.removeIndex('reviews', name);
    }

    await queryInterface.renameColumn('reviews', 'student_id', 'reviewer_id');
    await queryInterface.renameColumn('reviews', 'coach_id', 'target_user_id');

    await queryInterface.addIndex('reviews', ['reviewer_id'], { name: 'reviews_reviewer_id' });
    await queryInterface.addIndex('reviews', ['target_user_id'], { name: 'reviews_target_user_id' });
    await queryInterface.addIndex('reviews', ['target_user_id', 'created_at'], { name: 'reviews_target_created' });

    await queryInterface.addConstraint('reviews', {
      fields: ['reviewer_id'],
      type: 'foreign key',
      name: 'reviews_ibfk_2',
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addConstraint('reviews', {
      fields: ['target_user_id'],
      type: 'foreign key',
      name: 'reviews_ibfk_3',
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },
};
