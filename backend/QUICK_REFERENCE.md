# Quick Reference: Schema Changes Workflow

## 🚨 IMPORTANT: Where to Make Changes

### ❌ **STOP** Making Changes in SQL Workbench
- Don't edit tables directly in MySQL Workbench
- Don't run ALTER TABLE commands manually
- This breaks version control and team collaboration

### ✅ **START** Using Sequelize Migrations

## 📋 Step-by-Step: Making a Schema Change

### Example: Adding a new column to `users` table

#### 1. Create Migration File
```bash
cd backend
npx sequelize-cli migration:generate --name add-phone-verified-to-users
```

This creates: `migrations/20240101120000-add-phone-verified-to-users.js`

#### 2. Edit the Migration File
```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'phone_verified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'phone_verified');
  }
};
```

#### 3. Update the Model File
Edit `models/User.js`:
```javascript
phone_verified: {
  type: DataTypes.BOOLEAN,
  defaultValue: false,
  allowNull: false,
}
```

#### 4. Run the Migration
```bash
npm run db:migrate
```

#### 5. (If Needed) Rollback
```bash
npm run db:migrate:undo
```

## 🎯 Common Commands

```bash
# Create a new migration
npx sequelize-cli migration:generate --name your-migration-name

# Run all pending migrations
npm run db:migrate

# Undo last migration
npm run db:migrate:undo

# Check migration status
npx sequelize-cli db:migrate:status
```

## 📝 Migration File Template

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Your changes here
    // Examples:
    // await queryInterface.addColumn('table', 'column', { type: Sequelize.STRING });
    // await queryInterface.createTable('new_table', { ... });
    // await queryInterface.addIndex('table', ['column']);
  },

  async down(queryInterface, Sequelize) {
    // Reverse your changes here
    // This allows rollback
  }
};
```

## ✅ Your Current Status

- ✅ **All models created** - 30 models matching your SQL schema
- ✅ **Migrations folder ready** - Can create migrations now
- ✅ **Sequelize CLI configured** - Ready to use

## 🚀 Next Steps

1. **For initial setup**: Run your SQL schema in MySQL Workbench (one time)
2. **For future changes**: Use migrations (as shown above)
3. **Never edit SQL directly** - Always use migrations
