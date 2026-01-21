# Migration Guide: Complete Workflow

## 📖 Why This Setup?

### The Initial Approach: Database First, Then Migrations

**Why we created the database first:**
- You already had a complete SQL schema file
- It was faster to run the SQL schema directly in MySQL Workbench for initial setup
- The schema was already tested and working

**Why we added migrations after:**
- **Version Control**: Track all schema changes in git
- **Team Collaboration**: Everyone sees the same migration history
- **Production Safety**: Incremental, reversible database updates
- **Professional Standard**: Industry best practice for database management

**The Hybrid Approach:**
1. ✅ Initial setup: Run SQL schema directly (one-time)
2. ✅ Mark initial migration as executed (using `check-and-mark-migration.js`)
3. ✅ Future changes: Use migrations (professional workflow)

This gives you the best of both worlds: quick initial setup + professional ongoing maintenance.

---

## 🛠️ Helper Scripts Explained

### 1. `check-and-mark-migration.js`

**Purpose**: One-time script to mark the initial migration as executed when you've already run the SQL schema directly.

**When to use:**
- After running your SQL schema file in MySQL Workbench
- Before running any new migrations
- Only needed once for initial setup

**What it does:**
1. Connects to your database
2. Verifies all 30 expected tables exist
3. Checks basic schema structure matches
4. Marks `20260101171440-initial-schema.cjs` as executed in `SequelizeMeta` table

**Usage:**
```bash
node scripts/check-and-mark-migration.js
```

**After running:**
- ✅ Future migrations work normally with `npm run db:migrate`
- ✅ Sequelize CLI recognizes the initial migration as executed
- ✅ You can proceed with normal migration workflow

### 2. `compare-schema.js`

**Purpose**: Verify your database schema matches the initial migration file.

**When to use:**
- Before marking the initial migration as executed
- To verify schema matches after running SQL file
- One-time verification tool (not for regular migrations)

**What it does:**
- Compares your actual database schema with the initial migration file
- Reports missing tables, extra tables, and column differences
- Helps ensure schema matches before marking migration as executed

**Usage:**
```bash
node scripts/compare-schema.js
```

**Note**: This script is for the initial schema only. For regular migrations, just test manually.

---

## 📋 Complete Migration Workflow

### Step 1: Create Migration

```bash
npx sequelize-cli migration:generate --name your-migration-name
```

This creates: `migrations/YYYYMMDDHHMMSS-your-migration-name.js`

### Step 2: Write Migration Code

Edit the migration file with your changes:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Your changes here
    await queryInterface.addColumn('users', 'phone_verified', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    // Reverse your changes here (for rollback)
    await queryInterface.removeColumn('users', 'phone_verified');
  }
};
```

### Step 3: Update Model (If Needed)

**⚠️ Only update the model if the migration changes the schema structure.**

#### ✅ Update Model When:
- Adding a new column
- Removing a column
- Changing a column's data type
- Changing column constraints (allowNull, defaultValue, etc.)

**Example:** Adding `phone_verified` column
```javascript
// In models/User.js
phone_verified: {
  type: DataTypes.BOOLEAN,
  defaultValue: false,
  allowNull: false,
}
```

#### ❌ Don't Update Model When:
- Data migrations only (updating values, moving data)
- Performance indexes only (not affecting structure)
- Creating new tables (you'd create a new model file instead)

### Step 4: Run Migration

```bash
npm run db:migrate
```

This applies the migration to your database.

### Step 5: Test

Verify the changes work correctly:
- Test the affected endpoints
- Check database directly if needed
- Server auto-restarts with nodemon (no manual restart needed)

### Step 6: Commit

```bash
git add migrations/ models/User.js  # Include model if you updated it
git commit -m "Add phone_verified field to users"
```

---

## 🎯 Quick Decision Tree

```
New Migration Created
    │
    ├─ Does it add/remove/change columns? 
    │  └─ YES → Update model file ✅
    │  └─ NO  → Continue
    │
    ├─ Does it change data types or constraints?
    │  └─ YES → Update model file ✅
    │  └─ NO  → Continue
    │
    └─ Is it just data/indexes/constraints?
       └─ NO → Model update not required ✅
```

---

## 📝 Common Migration Examples

### Example 1: Adding a Column (Model Update Needed)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name add-bio-to-users

# 2. Write migration
# migrations/...-add-bio-to-users.js
async up(queryInterface, Sequelize) {
  await queryInterface.addColumn('users', 'bio', {
    type: Sequelize.TEXT,
    allowNull: true,
  });
}

# 3. Update model (models/User.js)
bio: {
  type: DataTypes.TEXT,
  allowNull: true,
}

# 4. Run migration
npm run db:migrate

# 5. Test & commit
```

### Example 2: Data Migration Only (No Model Update)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name backfill-user-timezones

# 2. Write migration (only updates data)
async up(queryInterface, Sequelize) {
  await queryInterface.sequelize.query(`
    UPDATE users 
    SET timezone = 'America/New_York' 
    WHERE timezone IS NULL
  `);
}

# 3. NO model update needed! ✅

# 4. Run migration
npm run db:migrate
```

### Example 3: Performance Index (No Model Update)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name add-user-performance-indexes

# 2. Write migration
async up(queryInterface, Sequelize) {
  await queryInterface.addIndex('users', ['role', 'is_active'], {
    name: 'idx_users_role_active',
  });
}

# 3. NO model update needed! ✅

# 4. Run migration
npm run db:migrate
```

---

## 🔄 Rollback

If you need to undo a migration:

```bash
npm run db:migrate:undo
```

This runs the `down()` function in the last migration.

---

## ✅ Current Status

- ✅ **Initial migration created** - `20260101171440-initial-schema.cjs`
- ✅ **Fix migration created** - `20260105172550-fix-foreign-keys-and-fulltext-index.cjs`
- ✅ **All 30 models created** - Match SQL schema exactly
- ✅ **Migrations folder ready** - Can create new migrations
- ✅ **Sequelize CLI configured** - Ready to use

---

## 🚨 Important Rules

### ❌ **NEVER** Do This:
- Don't edit tables directly in MySQL Workbench
- Don't run ALTER TABLE commands manually
- Don't skip migrations for schema changes

### ✅ **ALWAYS** Do This:
- Use migrations for all schema changes
- Update models when structure changes
- Test migrations before committing
- Commit migrations to git

---

## 💡 Pro Tips

1. **When in doubt, check the model** - If your migration changes what Sequelize needs to know about the table structure, update the model.

2. **Model = Structure, Migration = Change** - Models define the current structure, migrations define how to get there.

3. **Test after migration** - Even if you don't update the model, test to ensure the migration worked correctly.

4. **Server auto-restarts** - With `nodemon`, you don't need to restart `npm run dev` after model changes.

5. **Use descriptive names** - Migration names should clearly describe what they do (e.g., `add-phone-verified-to-users` not `update-users`).

---

## 📚 Summary

| Step | Always Required? | Notes |
|------|-------------------|-------|
| 1. Create migration | ✅ Yes | Always needed |
| 2. Write migration code | ✅ Yes | Always needed |
| 3. Update model | ⚠️ Conditional | Only if schema structure changes |
| 4. Run migration | ✅ Yes | Always needed to apply changes |
| 5. Test | ✅ Yes | Always good practice |
| 6. Commit | ✅ Yes | Always good practice |

**Bottom line:** Steps 1, 2, 4, 5, 6 are always needed. Step 3 (update model) is only needed when your migration changes the table structure that Sequelize models need to know about.

---

## 🔗 Related Documentation

- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick command reference
- **[SCHEMA_VERIFICATION.md](./SCHEMA_VERIFICATION.md)** - Schema verification report
