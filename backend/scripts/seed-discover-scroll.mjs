/**
 * Listed coaches for testing Discover's scroll-to-results (Use my location / Search).
 *
 * Six coaches around Davie (Broward) and three around Coral Gables (Miami), each linked to an existing
 * public court — no courts are created. Payout setup is simulated (`acct_seed_discover_*`, dev only; see
 * utils/devSeedStripeConnect.js). Re-runnable; only touches `discover.coach*@picklecoach.example.org`.
 *
 * Usage (from backend/): npm run seed:discover-scroll   ·   Password: Test1234!Ab
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });
if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const {
  sequelize, User, UserRole, CoachProfile, CoachAvailability, CoachCourtLocation, CourtLocation, Lesson,
} = await import('../models/index.js');
const { getCoachMarketplaceEligibility } = await import('../services/coachMarketplaceEligibility.js');
const { SEED_COACH_AVATAR_URL } = await import('../utils/seedCoachAvatar.cjs');
sequelize.options.logging = false;

const PASSWORD = 'Test1234!Ab';
const TZ = 'America/New_York';

const COACHES = [
  { name: 'Carlos Mendez', court: 'Suellen H. Fardelmann Sports Complex', city: 'Cooper City, FL', rating: 4.2, years: 6, price: 55, headline: 'Patient fundamentals for new players' },
  { name: 'Priya Shah', court: 'Plantation Central Park', city: 'Plantation, FL', rating: 4.8, years: 10, price: 80, headline: 'Advanced shot selection and match play' },
  { name: 'Derek Collins', court: 'Jacaranda Lakes Park', city: 'Plantation, FL', rating: 3.9, years: 3, price: 45, headline: 'Friendly lessons for beginners and seniors' },
  { name: 'Alicia Gomez', court: 'Stan Goldman Memorial Park', city: 'Hollywood, FL', rating: 4.5, years: 7, price: 65, headline: 'Dinking, resets, and soft-game control' },
  { name: 'Tom Becker', court: 'Weston Regional Pickleball Court', city: 'Weston, FL', rating: 4.0, years: 5, price: 60, headline: 'Serve, return, and third-shot consistency' },
  { name: 'Hannah Kim', court: 'Sunrise Middle School', city: 'Fort Lauderdale, FL', rating: 4.3, years: 4, price: 50, headline: 'Junior and family pickleball lessons' },
  { name: 'Marco Rossi', court: 'Brewer Park', city: 'South Miami, FL', rating: 4.4, years: 9, price: 70, headline: 'Doubles positioning and court awareness' },
  { name: 'Grace Okafor', court: 'Manolo Reyes Park', city: 'Miami, FL', rating: 4.1, years: 2, price: 40, headline: 'First-time player clinics, made simple' },
  { name: 'Ben Alvarez', court: 'Riviera Preparatory School', city: 'Kendall, FL', rating: 4.6, years: 8, price: 75, headline: 'Tournament prep and drilling' },
];

const passwordHash = await bcrypt.hash(PASSWORD, 10);
const rows = [];
for (const [i, spec] of COACHES.entries()) {
  const n = i + 1;
  const email = `discover.coach${n}@picklecoach.example.org`;
  const court = await CourtLocation.findOne({ where: { name: spec.court, deleted_at: null } });
  if (!court) throw new Error(`Court not found: ${spec.court}`);

  const fields = {
    full_name: spec.name, password_hash: passwordHash, timezone: TZ, is_active: true,
    email_verified_at: new Date(), deleted_at: null, avatar_url: SEED_COACH_AVATAR_URL,
  };
  let user = await User.findOne({ where: { email }, paranoid: false });
  if (user) await user.update(fields);
  else user = await User.create({ email, ...fields });
  await UserRole.findOrCreate({ where: { user_id: user.id, role: 'coach' } });

  const [profile] = await CoachProfile.findOrCreate({ where: { user_id: user.id }, defaults: { user_id: user.id } });
  await profile.update({
    headline: spec.headline,
    bio: `${spec.headline}. Lessons at ${spec.court}; every session ends with a short practice plan.`,
    experience_years: spec.years, skill_rating: spec.rating, rating_system: 'DUPR', location: spec.city,
    certifications: null, rating_average: 0, rating_count: 0, deleted_at: null,
    stripe_account_id: `acct_seed_discover_${n}`, stripe_ready: true, stripe_onboarding_completed_at: new Date(),
  });

  await CoachAvailability.destroy({ where: { coach_id: user.id } });
  await CoachCourtLocation.destroy({ where: { coach_id: user.id } });
  await Lesson.destroy({ where: { coach_id: user.id }, force: true });
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await CoachAvailability.create({ coach_id: user.id, weekday, start_time: '08:00:00', end_time: '20:00:00' });
  }
  await CoachCourtLocation.create({ coach_id: user.id, court_id: court.id });
  await Lesson.create({
    coach_id: user.id, title: 'Private lesson', description: spec.headline, price: spec.price,
    duration_minutes: 60, lesson_type: 'private', max_students: 1, is_active: true,
  });

  const eligibility = await getCoachMarketplaceEligibility(user.id);
  rows.push({ email, name: spec.name, court: `${spec.court} (${spec.city})`, listed: eligibility.listed });
}

console.table(rows);
console.log(`
Try on Discover (log in as tour.student@picklecoach.example.org / ${PASSWORD}):
  Use my location (Davie)  → about 9 coaches; page scrolls to the results
  Search "Davie, FL"       → about 10 coaches; scrolls to the results
  Search "Coral Gables, FL"→ about 7 coaches (incl. Maya and Leo if seed:feature-tour ran); scrolls to the results
  Search "Orlando, FL"     → no coaches; scrolls to the empty-results message
  Search "Springfield"     → several matches; stays at the search box to pick one
  Search "zzqxv"           → no matching location; stays at the search box`);
await sequelize.close();
