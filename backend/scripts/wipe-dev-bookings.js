/**
 * Wipe all booking-related rows in the development DB so My Bookings / payouts
 * can be retested from a clean slate.
 *
 * Keeps: users, roles, coach profiles, lessons, courts, availability,
 *        dispute type catalogs, promo codes.
 *
 * Removes: bookings and every dependent money/messaging/review/dispute row,
 *          plus booking-related in-app notifications, and orphaned payouts.
 *
 * Usage (from backend/):
 *   NODE_ENV=development node scripts/wipe-dev-bookings.js --confirm
 *
 * Optional:
 *   --also-audit   also truncate audit_logs + webhook_logs (noisier cleanup)
 */
import dotenv from 'dotenv';
import { sequelize } from '../models/index.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

if (!process.argv.includes('--confirm')) {
  console.error('Refusing to run without --confirm');
  console.error('Usage: NODE_ENV=development node scripts/wipe-dev-bookings.js --confirm');
  process.exit(1);
}

const alsoAudit = process.argv.includes('--also-audit');

const COUNT_SQL = `
SELECT 'bookings' AS t, COUNT(*) AS n FROM bookings
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'payouts', COUNT(*) FROM payouts
UNION ALL SELECT 'disputes', COUNT(*) FROM disputes
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'payment_actions', COUNT(*) FROM payment_actions
UNION ALL SELECT 'cancellation_history', COUNT(*) FROM cancellation_history
UNION ALL SELECT 'student_feedback', COUNT(*) FROM student_feedback
UNION ALL SELECT 'booking_players', COUNT(*) FROM booking_players
`;

async function counts() {
  const [rows] = await sequelize.query(COUNT_SQL);
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
}

async function main() {
  await sequelize.authenticate();
  const before = await counts();
  console.log('Before:', before);

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    // Child → parent order (MySQL InnoDB FKs).
    await q('DELETE FROM conversation_reads');
    await q('DELETE FROM messages');
    await q('DELETE FROM conversations');
    await q('DELETE FROM student_feedback');
    await q('DELETE FROM reviews');
    await q('DELETE FROM payouts');
    await q('DELETE FROM payment_actions');
    await q('DELETE FROM cancellation_history');
    // payments.dispute_id may reference disputes; clear link then delete both.
    await q('UPDATE payments SET dispute_id = NULL');
    await q('DELETE FROM disputes');
    await q('DELETE FROM payments');
    await q('DELETE FROM booking_players');
    await q('DELETE FROM bookings');

    // Booking-centric in-app noise (keep auth/system mail rows if any).
    await q(`
      DELETE FROM notifications
      WHERE channel = 'in_app'
         OR entity_type IN ('booking', 'dispute', 'message', 'review', 'payment', 'payout')
         OR type LIKE 'booking_%'
         OR type LIKE 'pre_lesson_%'
         OR type LIKE '%_no_show'
         OR type IN (
           'confirm_attendance_reminder',
           'lesson_completed',
           'dispute_opened',
           'dispute_resolved',
           'new_message',
           'review_received',
           'refund_succeeded'
         )
    `);

    if (alsoAudit) {
      await q('DELETE FROM audit_logs');
      await q('DELETE FROM webhook_logs');
    }
  });

  const after = await counts();
  console.log('After:', after);
  console.log('\n✅ Booking lifecycle data wiped. Users / coaches / lessons / courts kept.');
  console.log('Next:');
  console.log('  1. Restart backend (so workers pick up clean state).');
  console.log('  2. Log in as student → Discover → book a lesson (Stripe test card).');
  console.log('  3. Log in as coach → Accept.');
  console.log('  4. After lesson end → Mark complete (or wait for awaiting_verification).');
  console.log('  5. To end a future lesson early (coach still clicks Mark complete):');
  console.log('       npm run booking:end-lesson -- --booking-id=<ID> --confirm');
  console.log('  6. After complete, to skip the 24h payout wait:');
  console.log('       npm run booking:fast-forward-payout-clock -- --booking-id=<ID> --confirm');
  console.log('     then wait for payoutWorker (~10 min) with stripe listen running.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Wipe failed:', err.message);
  console.error(err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
}).finally(async () => {
  try { await sequelize.close(); } catch { /* ignore */ }
});
