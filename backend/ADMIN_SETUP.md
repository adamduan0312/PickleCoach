# Admin Account Setup Guide

## Overview

Admin accounts are hidden from normal users. Regular users can only register as `'student'` or `'coach'` roles. Admin functionality is only accessible to users with the `'admin'` role.

## Creating Admin Accounts

### First Admin Account (Manual Creation)

The first admin account must be created manually via the database, as there's no way to create an admin through the public API.

**Option 1: Direct SQL**
```sql
INSERT INTO users (full_name, email, password_hash, role, is_active, created_at)
VALUES (
  'Admin User',
  'admin@picklecoach.com',
  -- Use bcrypt to hash your password (e.g., using Node.js: bcrypt.hashSync('yourpassword', 10))
  '$2a$10$...your_bcrypt_hash_here...',
  'admin',
  1,
  NOW()
);
```

**Option 2: Using Node.js Script**
Create a one-time setup script:
```javascript
import bcrypt from 'bcryptjs';
import { User } from './models/index.js';

const adminUser = await User.create({
  full_name: 'Admin User',
  email: 'admin@picklecoach.com',
  password_hash: await bcrypt.hash('your_secure_password', 10),
  role: 'admin',
  is_active: true,
});
```

### Additional Admin Accounts

Once the first admin account exists, admins can create additional admin accounts using the admin-only API endpoint:

**Endpoint:** `POST /api/admin/users`

**Headers:**
```
Authorization: Bearer <admin_jwt_token>
```

**Request Body:**
```json
{
  "full_name": "New Admin Name",
  "email": "newadmin@picklecoach.com",
  "password": "secure_password_here",
  "phone": "optional",
  "timezone": "UTC"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "full_name": "New Admin Name",
    "email": "newadmin@picklecoach.com",
    "role": "admin",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "message": "Admin account created successfully"
}
```

## Admin Functionality

### Protected Routes

All admin routes are protected with `authenticate` and `authorize('admin')` middleware:
- `/api/admin/dashboard` - Dashboard statistics
- `/api/admin/users` - Create admin accounts

### Admin Capabilities

Admins can:
- View dashboard statistics
- Create additional admin accounts
- Access all admin-protected endpoints
- See all user data (via admin routes)

### Reliability Scoring for Admins

- Admins are treated like **coaches** for reliability scoring purposes
- Admins receive coach reliability scores if they create lessons/bookings
- Monthly reliability resets apply to admins (same as coaches)
- Admins start with a reliability score of 100.00

## Security Notes

1. **No Public Admin Registration**: The registration endpoint (`POST /api/auth/register`) only accepts `'student'` or `'coach'` roles
2. **Admin Login**: Admins can login through the normal login endpoint (`POST /api/auth/login`)
3. **Role in JWT**: The user's role is included in the JWT token, allowing the frontend to conditionally show/hide admin UI
4. **Backend Authorization**: All admin endpoints verify the user's role is `'admin'` before allowing access

## Frontend Implementation Notes

1. **Registration Form**: Only show `'student'` and `'coach'` options
2. **Login**: Handle admin role by redirecting to admin dashboard if `role === 'admin'`
3. **Conditional UI**: Hide admin-related features unless `user.role === 'admin'`
4. **Navigation**: Show admin navigation items only to admin users

## Example: Creating First Admin via Node.js Script

Create `scripts/create-first-admin.js`:

```javascript
import bcrypt from 'bcryptjs';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';

async function createFirstAdmin() {
  try {
    await sequelize.authenticate();
    
    const email = process.argv[2];
    const password = process.argv[3];
    const fullName = process.argv[4] || 'Admin User';

    if (!email || !password) {
      console.error('Usage: node create-first-admin.js <email> <password> [full_name]');
      process.exit(1);
    }

    const existingAdmin = await User.findOne({ where: { email } });
    if (existingAdmin) {
      console.error('User with this email already exists');
      process.exit(1);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const admin = await User.create({
      full_name: fullName,
      email,
      password_hash,
      role: 'admin',
      is_active: true,
    });

    console.log('Admin created successfully:', admin.toJSON());
    await sequelize.close();
  } catch (error) {
    console.error('Error creating admin:', error);
    process.exit(1);
  }
}

createFirstAdmin();
```

Run with:
```bash
node scripts/create-first-admin.js admin@picklecoach.com securepassword "Admin Name"
```

