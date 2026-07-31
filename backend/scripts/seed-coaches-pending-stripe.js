/**
 * Complete marketplace checklist for coaches who are missing lesson/court/availability,
 * while keeping Stripe unset (stripe_ready=false, no Connect account).
 *
 * Use these accounts for real Stripe Connect onboarding (Phase A4 / Phase B).
 *
 * Also creates a dedicated verified coach:
 *   coach.pendingstripe@picklecoach.example.org / Test1234!Ab
 *
 * Completes demo coaches coach6@example.com … coach10@example.com when present
 * (password from demo seed: Test1234!Ab).
 *
 * Run from backend/:
 *   npm run seed:coaches-pending-stripe
 */
import dotenv from 'dotenv';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

import bcrypt from 'bcryptjs';
import {
  sequelize,
  User,
  UserRole,
  CoachProfile,
  CourtLocation,
  CoachCourtLocation,
  Lesson,
  CoachAvailability,
} from '../models/index.js';
import { getCoachMarketplaceEligibility } from '../services/coachMarketplaceEligibility.js';

const PASSWORD = 'Test1234!Ab';
const DEDICATED_EMAIL = 'coach.pendingstripe@picklecoach.example.org';

const DEMO_PENDING = [6, 7, 8, 9, 10].map((n) => `coach${n}@example.com`);

/** Distinct public courts near NYC so coaches stay within a local cluster. */
const COURT_SPECS = [
  {
    name: 'Pending-Stripe Court A — Brooklyn Bridge Park',
    address_line1: '334 Furman St',
    city: 'Brooklyn',
    state: 'NY',
    postal_code: '11201',
    latitude: 40.6993,
    longitude: -73.9972,
  },
  {
    name: 'Pending-Stripe Court B — Prospect Park',
    address_line1: '95 Prospect Park W',
    city: 'Brooklyn',
    state: 'NY',
    postal_code: '11215',
    latitude: 40.6602,
    longitude: -73.9690,
  },
  {
    name: 'Pending-Stripe Court C — McCarren Park',
    address_line1: '776 Lorimer St',
    city: 'Brooklyn',
    state: 'NY',
    postal_code: '11222',
    latitude: 40.7210,
    longitude: -73.9500,
  },
  {
    name: 'Pending-Stripe Court D — Central Park',
    address_line1: '830 5th Ave',
    city: 'New York',
    state: 'NY',
    postal_code: '10065',
    latitude: 40.7678,
    longitude: -73.9718,
  },
  {
    name: 'Pending-Stripe Court E — Riverside Park',
    address_line1: '353 Riverside Dr',
    city: 'New York',
    state: 'NY',
    postal_code: '10025',
    latitude: 40.7910,
    longitude: -73.9750,
  },
  {
    name: 'Pending-Stripe Court F — Astoria Park',
    address_line1: '19th St & 23rd Dr',
    city: 'Astoria',
    state: 'NY',
    postal_code: '11105',
    latitude: 40.7795,
    longitude: -73.9225,
  },
];

async function ensureCourt(spec, createdByUserId) {
  const existing = await CourtLocation.findOne({
    where: {
      name: spec.name,
      address_line1: spec.address_line1,
      city: spec.city,
      state: spec.state,
      postal_code: spec.postal_code,
      country: 'US',
      deleted_at: null,
    },
  });
  if (existing) return existing;

  return CourtLocation.create({
    ...spec,
    country: 'US',
    is_private: false,
    source: 'manual',
    created_by_user_id: createdByUserId,
  });
}

async function ensureAvailability(coachId) {
  const count = await CoachAvailability.count({ where: { coach_id: coachId } });
  if (count > 0) return count;

  for (let weekday = 1; weekday <= 5; weekday++) {
    await CoachAvailability.create({
      coach_id: coachId,
      weekday,
      start_time: '09:00:00',
      end_time: '17:00:00',
    });
  }
  return 5;
}

async function ensureLesson(coachId, titleSuffix) {
  const existing = await Lesson.findOne({
    where: { coach_id: coachId, is_active: true, deleted_at: null },
  });
  if (existing) return existing;

  return Lesson.create({
    coach_id: coachId,
    title: `Intro Lesson — Pending Stripe (${titleSuffix})`,
    description: 'Marketplace-ready fixture for Stripe Connect onboarding tests. Stripe not connected yet.',
    price: 55.0,
    duration_minutes: 60,
    max_students: 1,
    is_active: true,
  });
}

async function ensureCourtLink(coachId, courtId) {
  const [link] = await CoachCourtLocation.findOrCreate({
    where: { coach_id: coachId, court_id: courtId },
    defaults: { coach_id: coachId, court_id: courtId },
  });
  return link;
}

async function clearStripe(profile) {
  await profile.update({
    stripe_account_id: null,
    stripe_ready: false,
    stripe_onboarding_completed_at: null,
  });
}

async function completeCoach(user, { courtSpec, titleSuffix }) {
  await user.update({
    email_verified_at: user.email_verified_at || new Date(),
    is_active: true,
  });

  let profile = await CoachProfile.findOne({
    where: { user_id: user.id, deleted_at: null },
  });
  if (!profile) {
    profile = await CoachProfile.create({
      user_id: user.id,
      headline: `Pending Stripe — ${titleSuffix}`,
      bio: 'Coach fixture ready for Connect onboarding (no Stripe yet).',
      experience_years: 4,
      skill_rating: 3.5,
      rating_system: 'self',
      location: `${courtSpec.city}, ${courtSpec.state}`,
      coach_commission_percent: 92.0,
      stripe_account_id: null,
      stripe_ready: false,
      stripe_onboarding_completed_at: null,
    });
  } else {
    await clearStripe(profile);
    if (!profile.headline) {
      await profile.update({ headline: `Pending Stripe — ${titleSuffix}` });
    }
  }

  const court = await ensureCourt(courtSpec, user.id);
  await ensureCourtLink(user.id, court.id);
  const lesson = await ensureLesson(user.id, titleSuffix);
  const availCount = await ensureAvailability(user.id);
  const eligibility = await getCoachMarketplaceEligibility(user.id);

  return {
    email: user.email,
    userId: user.id,
    lessonId: lesson.id,
    courtId: court.id,
    availabilityRows: availCount,
    eligibility,
  };
}

async function ensureDedicatedCoach() {
  let user = await User.findOne({
    where: { email: DEDICATED_EMAIL },
    include: [{ model: UserRole, as: 'userRoles', attributes: ['role'] }],
  });

  if (!user) {
    const password_hash = await bcrypt.hash(PASSWORD, 10);
    user = await User.create({
      full_name: 'Pending Stripe Coach',
      email: DEDICATED_EMAIL,
      password_hash,
      phone: '555-0199',
      timezone: 'America/New_York',
      is_active: true,
      email_verified_at: new Date(),
    });
    await UserRole.create({ user_id: user.id, role: 'coach' });
  } else {
    const roles = (user.userRoles || []).map((r) => r.role);
    if (!roles.includes('coach')) {
      await UserRole.create({ user_id: user.id, role: 'coach' });
    }
  }

  return completeCoach(user, {
    courtSpec: COURT_SPECS[0],
    titleSuffix: 'dedicated',
  });
}

async function main() {
  await sequelize.authenticate();
  const results = [];

  results.push(await ensureDedicatedCoach());

  for (let i = 0; i < DEMO_PENDING.length; i++) {
    const email = DEMO_PENDING[i];
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.warn(`Skip missing user: ${email}`);
      continue;
    }
    results.push(
      await completeCoach(user, {
        courtSpec: COURT_SPECS[(i + 1) % COURT_SPECS.length],
        titleSuffix: `coach${i + 6}`,
      }),
    );
  }

  console.log('\nCoaches ready for Stripe Connect (marketplace except stripe):\n');
  console.log(`Password for all: ${PASSWORD}\n`);
  for (const r of results) {
    const ok =
      r.eligibility.listed === false &&
      Array.isArray(r.eligibility.missing) &&
      r.eligibility.missing.length === 1 &&
      r.eligibility.missing[0] === 'stripe';
    console.log(
      `${ok ? '✓' : '✗'} ${r.email} (id=${r.userId}) listed=${r.eligibility.listed} missing=${JSON.stringify(r.eligibility.missing)} lesson=${r.lessonId} court=${r.courtId}`,
    );
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
