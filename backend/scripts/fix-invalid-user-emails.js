/**
 * Rewrites @picklecoach.test user emails to @picklecoach.example.org (Joi-valid).
 * Run from backend/: node scripts/fix-invalid-user-emails.js
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User } from '../models/index.js';

const OLD_DOMAIN = '@picklecoach.test';
const NEW_DOMAIN = '@picklecoach.example.org';
/** Matches `npm run seed:test-flows` documented password. */
const TESTFLOW_PASSWORD = 'Test1234!Ab';

async function main() {
  const legacyUsers = await User.findAll({
    where: { email: { [Op.like]: `%${OLD_DOMAIN}` } },
    order: [['id', 'ASC']],
  });

  if (legacyUsers.length === 0) {
    console.log('No @picklecoach.test users found.');
  } else {
    console.log(`Updating ${legacyUsers.length} user(s) from ${OLD_DOMAIN} → ${NEW_DOMAIN}...`);
    for (const user of legacyUsers) {
      const oldEmail = user.email;
      const newEmail = oldEmail.replace(OLD_DOMAIN, NEW_DOMAIN);
      const validation = Joi.string().email().max(150).validate(newEmail);
      if (validation.error) {
        throw new Error(`User ${user.id}: ${newEmail} is not Joi-valid: ${validation.error.message}`);
      }
      const conflict = await User.findOne({ where: { email: newEmail } });
      if (conflict && conflict.id !== user.id) {
        throw new Error(`User ${user.id}: target email already taken by user ${conflict.id}`);
      }
      await user.update({ email: newEmail });
      console.log(`  id ${user.id}: ${oldEmail} → ${newEmail}`);
      if (newEmail.includes('.testflow@')) {
        const password_hash = await bcrypt.hash(TESTFLOW_PASSWORD, 10);
        await user.update({ password_hash });
        console.log(`    password reset → ${TESTFLOW_PASSWORD} (test-flow seed convention)`);
      }
    }
  }

  // Re-sync test-flow passwords if emails were already migrated but login still fails.
  const testflowUsers = await User.findAll({
    where: { email: { [Op.like]: '%.testflow@picklecoach.example.org' } },
    order: [['id', 'ASC']],
  });
  for (const user of testflowUsers) {
    const password_hash = await bcrypt.hash(TESTFLOW_PASSWORD, 10);
    await user.update({ password_hash });
    console.log(`  test-flow password synced: ${user.email}`);
  }

  const allUsers = await User.findAll({ attributes: ['id', 'email'], order: [['id', 'ASC']] });
  const invalid = [];
  for (const u of allUsers) {
    const r = Joi.string().email().max(150).validate(u.email);
    if (r.error) invalid.push({ id: u.id, email: u.email, reason: r.error.message });
  }

  if (invalid.length) {
    console.error('Still invalid after fix:', invalid);
    process.exit(1);
  }

  console.log(`✅ All ${allUsers.length} user emails pass Joi validation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
