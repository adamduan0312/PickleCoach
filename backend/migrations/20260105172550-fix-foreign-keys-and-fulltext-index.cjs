'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Helper function to find and drop foreign key constraint
    const dropForeignKey = async (tableName, columnName) => {
      const [constraints] = await queryInterface.sequelize.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `, {
        replacements: [tableName, columnName]
      });

      if (constraints && constraints.length > 0) {
        const constraintName = constraints[0].CONSTRAINT_NAME;
        await queryInterface.sequelize.query(`
          ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\`
        `);
        console.log(`Dropped foreign key ${constraintName} from ${tableName}.${columnName}`);
      }
    };

    // Helper function to add foreign key with RESTRICT
    const addForeignKey = async (tableName, columnName, referencedTable, referencedColumn = 'id') => {
      await queryInterface.sequelize.query(`
        ALTER TABLE \`${tableName}\`
        ADD CONSTRAINT \`${tableName}_${columnName}_fk\`
        FOREIGN KEY (\`${columnName}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
      `);
      console.log(`Added RESTRICT foreign key for ${tableName}.${columnName}`);
    };

    console.log('Fixing foreign key constraints...');

    // 1. Fix coach_profiles.user_id
    await dropForeignKey('coach_profiles', 'user_id');
    await addForeignKey('coach_profiles', 'user_id', 'users');

    // 2. Fix bookings.lesson_id
    await dropForeignKey('bookings', 'lesson_id');
    await addForeignKey('bookings', 'lesson_id', 'lessons');

    // 3. Fix bookings.coach_id
    await dropForeignKey('bookings', 'coach_id');
    await addForeignKey('bookings', 'coach_id', 'users');

    // 4. Fix conversations.booking_id
    await dropForeignKey('conversations', 'booking_id');
    await addForeignKey('conversations', 'booking_id', 'bookings');

    console.log('Adding FULLTEXT index for messages.content...');

    // 5. Add FULLTEXT index for messages.content (if it doesn't exist)
    try {
      const [existingIndexes] = await queryInterface.sequelize.query(`
        SELECT INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'messages'
          AND INDEX_NAME = 'ft_messages_content'
      `);

      if (!existingIndexes || existingIndexes.length === 0) {
        await queryInterface.sequelize.query(`
          ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_content (content)
        `);
        console.log('Added FULLTEXT index ft_messages_content to messages.content');
      } else {
        console.log('FULLTEXT index ft_messages_content already exists, skipping');
      }
    } catch (error) {
      console.log('Error checking/adding FULLTEXT index:', error.message);
      // Try to add it anyway (might fail if it exists, which is OK)
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE messages ADD FULLTEXT INDEX ft_messages_content (content)
        `);
        console.log('Added FULLTEXT index ft_messages_content to messages.content');
      } catch (addError) {
        console.log('FULLTEXT index might already exist, continuing...');
      }
    }

    console.log('Migration completed successfully!');
  },

  async down(queryInterface, Sequelize) {
    // Helper function to find and drop foreign key constraint
    const dropForeignKey = async (tableName, columnName) => {
      const [constraints] = await queryInterface.sequelize.query(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `, {
        replacements: [tableName, columnName]
      });

      if (constraints && constraints.length > 0) {
        const constraintName = constraints[0].CONSTRAINT_NAME;
        await queryInterface.sequelize.query(`
          ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\`
        `);
      }
    };

    // Helper function to add foreign key with CASCADE (original behavior)
    const addForeignKey = async (tableName, columnName, referencedTable, referencedColumn = 'id') => {
      await queryInterface.sequelize.query(`
        ALTER TABLE \`${tableName}\`
        ADD CONSTRAINT \`${tableName}_${columnName}_fk\`
        FOREIGN KEY (\`${columnName}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)
        ON UPDATE CASCADE
        ON DELETE CASCADE
      `);
    };

    console.log('Reverting foreign key constraints to CASCADE...');

    // Revert foreign keys back to CASCADE
    await dropForeignKey('conversations', 'booking_id');
    await addForeignKey('conversations', 'booking_id', 'bookings');

    await dropForeignKey('bookings', 'coach_id');
    await addForeignKey('bookings', 'coach_id', 'users');

    await dropForeignKey('bookings', 'lesson_id');
    await addForeignKey('bookings', 'lesson_id', 'lessons');

    await dropForeignKey('coach_profiles', 'user_id');
    await addForeignKey('coach_profiles', 'user_id', 'users');

    console.log('Removing FULLTEXT index...');

    // Remove FULLTEXT index
    try {
      await queryInterface.sequelize.query(`
        ALTER TABLE messages DROP INDEX ft_messages_content
      `);
    } catch (error) {
      console.log('Index ft_messages_content not found or already removed');
    }

    console.log('Rollback completed');
  }
};
