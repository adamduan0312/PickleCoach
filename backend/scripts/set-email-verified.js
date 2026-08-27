/**
 * Set or clear email_verified_at for a user (dev/QA convenience).
 *
 * Usage:
 *   node scripts/set-email-verified.js <email>              # print status
 *   node scripts/set-email-verified.js <email> off          # unverify
 *   node scripts/set-email-verified.js <email> on           # verify now
 *
 * npm:
 *   npm run user:email-verified -- <email>
 *   npm run user:email-verified -- <email> off
 *   npm run user:email-verified -- <email> on
 */
import dotenv from 'dotenv';
import { sequelize } from '../models/sequelize.js';
import { User } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

function usage() {
  console.error('Usage: node scripts/set-email-verified.js <email> [on|off]');
}

async function main() {
  const email = process.argv[2];
  const mode = process.argv[3]; // 'on' | 'off' | undefined

  if (!email) {
    usage();
    process.exit(1);
  }
  if (mode && mode !== 'on' && mode !== 'off') {
    console.error('Second arg must be "on" or "off" (or omit to print status).');
    usage();
    process.exit(1);
  }

  try {
    await sequelize.authenticate();

    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.error('❌ No user found with email:', email);
      process.exit(1);
    }

    console.log(
      'User: id=%s, email=%s, email_verified_at=%s',
      user.id,
      user.email,
      user.email_verified_at ? user.email_verified_at.toISOString() : 'null',
    );

    if (!mode) {
      process.exit(0);
    }

    if (mode === 'off') {
      await user.update({
        email_verified_at: null,
        email_verification_token: null,
        email_verification_expires: null,
        email_verification_last_sent_at: null,
      });
      console.log('✅ Unverified', email, '(email_verified_at = null; verification tokens cleared)');
    } else {
      const verifiedAt = new Date();
      await user.update({
        email_verified_at: verifiedAt,
        email_verification_token: null,
        email_verification_expires: null,
      });
      console.log('✅ Verified', email, 'at', verifiedAt.toISOString());
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
