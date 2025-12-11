# Migration Workflow: What Steps Do You Need?

## 🎯 Short Answer

**No, you don't need to do ALL steps every time.** Here's what's actually required:

## 📋 Step-by-Step Breakdown

### ✅ **ALWAYS Required Steps:**

1. **Create migration** - `npx sequelize-cli migration:generate --name add-new-feature`
2. **Write migration code** - Edit the migration file
3. **Run migration** - `npm run db:migrate` (to apply to database)
4. **Test** - Verify it works
5. **Commit** - `git add migrations/` and commit

### ⚠️ **CONDITIONALLY Required Step:**

**Step 3: Update Model** - **ONLY if the migration changes the schema structure**

## 🔍 When Do You Need to Update the Model?

### ✅ **YES, Update Model When:**
- Adding a new column to a table
- Removing a column from a table
- Changing a column's data type
- Changing a column's constraints (allowNull, defaultValue, etc.)
- Adding/removing indexes that affect model behavior

**Example:** Adding `phone_verified` column to `users` table
```javascript
// Migration adds column → MUST update models/User.js
```

### ❌ **NO, Don't Update Model When:**
- **Data migrations only** (moving data, updating values)
- **Index-only changes** (adding indexes for performance, not affecting model structure)
- **Constraint changes** that don't affect Sequelize model definition
- **Creating new tables** (you'd create a new model file, not update existing)

**Example:** Adding an index for performance
```javascript
// Migration adds index → Model doesn't need update
await queryInterface.addIndex('users', ['email', 'role']);
```

## 📝 Typical Workflow Examples

### Example 1: Adding a Column (Model Update Needed)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name add-bio-to-users

# 2. Write migration (migrations/...-add-bio-to-users.js)
# Add column in up(), remove in down()

# 3. Update model (models/User.js)
# Add bio field definition

# 4. Run migration
npm run db:migrate

# 5. Test
# Server auto-restarts (nodemon), test in browser

# 6. Commit
git add migrations/ models/User.js
git commit -m "Add bio field to users"
```

### Example 2: Data Migration Only (No Model Update)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name backfill-user-timezones

# 2. Write migration (migrations/...-backfill-user-timezones.js)
# Only updates data, no schema changes

# 3. NO model update needed! ✅

# 4. Run migration
npm run db:migrate

# 5. Test
# Verify data was updated correctly

# 6. Commit
git add migrations/
git commit -m "Backfill user timezones"
```

### Example 3: Performance Index (No Model Update)

```bash
# 1. Create migration
npx sequelize-cli migration:generate --name add-user-performance-indexes

# 2. Write migration (migrations/...-add-user-performance-indexes.js)
```

**Migration file content:**
```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add composite index on role and is_active
    // Improves queries like "Get all active coaches"
    await queryInterface.addIndex('users', ['role', 'is_active'], {
      name: 'idx_users_role_active',
    });

    // Add index on last_login for sorting active users
    await queryInterface.addIndex('users', ['last_login'], {
      name: 'idx_users_last_login',
      where: {
        last_login: { [Sequelize.Op.ne]: null }
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'idx_users_last_login');
    await queryInterface.removeIndex('users', 'idx_users_role_active');
  }
};
```

```bash
# 3. NO model update needed! ✅
# These are performance indexes, not structural changes

# 4. Run migration
npm run db:migrate

# 5. Test
# Verify queries are faster (check query execution time)

# 6. Commit
git add migrations/
git commit -m "Add performance indexes on users table"
```

**Note:** See `migrations/example-add-user-performance-index.js` for a complete working example.

## 🚀 Quick Decision Tree

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

## 💡 Pro Tips

1. **When in doubt, check the model** - If your migration changes what Sequelize needs to know about the table structure, update the model.

2. **Model = Structure, Migration = Change** - Models define the current structure, migrations define how to get there.

3. **Test after migration** - Even if you don't update the model, test to ensure the migration worked correctly.

4. **Server auto-restarts** - With `nodemon`, you don't need to restart `npm run dev` after model changes.

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
