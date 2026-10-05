/**
 * Reset one coach account in the development DB so profile creation and the
 * marketplace listing can be retested from scratch.
 *
 * Keeps: the user row (email, password, verification), roles, audit logs,
 *        and the shared court directory.
 *
 * Removes: coach profile (incl. Stripe Connect link), photos (rows + files),
 *          availability, linked courts, lessons, every booking the user is in
 *          and its payments/payouts/disputes/reviews/messages, notifications,
 *          and reliability history.
 *
 * Usage (from backend/):
 *   NODE_ENV=development node scripts/reset-dev-coach.js --email=you@example.com --confirm
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sequelize } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const email = process.argv.find((a) => a.startsWith('--email='))?.slice('--email='.length);
if (!email || !process.argv.includes('--confirm')) {
  console.error('Usage: NODE_ENV=development node scripts/reset-dev-coach.js --email=you@example.com --confirm');
  process.exit(1);
}

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const [user] = await sequelize.query('SELECT id, email FROM users WHERE email = ?', {
    replacements: [email],
    type: 'SELECT',
  });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  const uid = user.id;

  const photoUrls = (await sequelize.query('SELECT url FROM coach_photos WHERE coach_id = ?', {
    replacements: [uid],
    type: 'SELECT',
  })).map((r) => r.url);

  const removed = {};
  await sequelize.transaction(async (transaction) => {
    const run = async (label, sql, replacements = { uid }) => {
      const [res] = await sequelize.query(sql, { replacements, transaction });
      if (label) removed[label] = (removed[label] || 0) + (res?.affectedRows ?? 0);
    };

    const bookingIds = (await sequelize.query(
      `SELECT id FROM bookings WHERE coach_id = :uid OR primary_student_id = :uid
         OR id IN (SELECT booking_id FROM booking_players WHERE player_id = :uid)`,
      { replacements: { uid }, type: 'SELECT', transaction },
    )).map((r) => r.id);
    const b = bookingIds.length ? bookingIds : [0];

    await run('conversations', 'DELETE FROM conversations WHERE booking_id IN (:b)', { b });
    await run('reviews', 'DELETE FROM reviews WHERE booking_id IN (:b) OR coach_id = :uid', { b, uid });
    await run('student_feedback', 'DELETE FROM student_feedback WHERE booking_id IN (:b) OR coach_id = :uid', { b, uid });
    await run(
      'weather_cancellation_requests',
      `DELETE FROM weather_cancellation_requests
        WHERE booking_id IN (:b) OR requested_by_user_id = :uid OR responded_by_user_id = :uid`,
      { b, uid },
    );
    await run(
      'payouts',
      'DELETE FROM payouts WHERE coach_id = :uid OR payment_id IN (SELECT id FROM payments WHERE booking_id IN (:b))',
      { b, uid },
    );
    await run(null, 'UPDATE payments SET dispute_id = NULL WHERE booking_id IN (:b)', { b });
    await run('disputes', 'DELETE FROM disputes WHERE booking_id IN (:b)', { b });
    await run('payments', 'DELETE FROM payments WHERE booking_id IN (:b) OR coach_id = :uid', { b, uid });
    await run('bookings', 'DELETE FROM bookings WHERE id IN (:b)', { b });

    await run('lessons', 'DELETE FROM lessons WHERE coach_id = :uid');
    await run('coach_photos', 'DELETE FROM coach_photos WHERE coach_id = :uid');
    await run('coach_availabilities', 'DELETE FROM coach_availabilities WHERE coach_id = :uid');
    await run('coach_court_locations', 'DELETE FROM coach_court_locations WHERE coach_id = :uid');
    await run('coach_profiles', 'DELETE FROM coach_profiles WHERE user_id = :uid');
    await run('notifications', 'DELETE FROM notifications WHERE user_id = :uid');
    await run('conversation_reads', 'DELETE FROM conversation_reads WHERE user_id = :uid');
    await run('user_reliability', 'DELETE FROM user_reliability WHERE user_id = :uid');
  });

  let filesDeleted = 0;
  for (const url of photoUrls) {
    if (!url?.startsWith('/uploads/')) continue;
    try {
      await fs.unlink(path.join(backendRoot, url));
      filesDeleted += 1;
    } catch {
      // Already gone or stored elsewhere.
    }
  }

  console.log(`Reset ${user.email} (user ${uid}). Rows removed:`, removed, `Photo files deleted: ${filesDeleted}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
