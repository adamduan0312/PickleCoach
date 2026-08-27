/**
 * Seed marketplace-ready coaches + courts near Pinecrest, FL
 * (village center ≈ 25.6670, -80.3080) for local Discover / booking QA.
 *
 * Idempotent — safe to re-run. Passwords: Test1234!Ab
 *
 * From backend/:
 *   npm run seed:pinecrest-near-me
 */
import dotenv from 'dotenv';
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

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

if (env !== 'development') {
  console.error('Refusing to run: NODE_ENV must be development');
  process.exit(1);
}

const PASSWORD = 'Test1234!Ab';
const DOMAIN = 'picklecoach.example.org';

/** Search origin for QA: Pinecrest village center / US-1 corridor */
export const PINECREST_ORIGIN = {
  label: 'Pinecrest, Florida (village center)',
  lat: 25.6670,
  lng: -80.3080,
};

/**
 * Courts / coaches at increasing distance from Pinecrest for radius tests.
 * Distances are approximate straight-line miles.
 */
const COACHES = [
  {
    emailLocal: 'coach.pinecrest.gardens',
    fullName: 'Piper Pinecrest',
    headline: '~0.5 mi — Pinecrest Gardens / Red Road',
    bio: 'Neighborhood coach for Discover “near me” booking tests (Pinecrest).',
    skill_rating: 3.5,
    rating_system: 'self',
    rating_average: 4.6,
    rating_count: 11,
    experience_years: 5,
    location: 'Pinecrest, FL',
    approxMiles: 0.5,
    court: {
      name: 'Near-Me Fixture — Pinecrest Gardens Courts',
      address_line1: '11000 SW 57th Ave',
      city: 'Pinecrest',
      state: 'FL',
      postal_code: '33156',
      latitude: 25.6665,
      longitude: -80.2890,
    },
    lessonPrice: 55,
  },
  {
    emailLocal: 'coach.pinecrest.killian',
    fullName: 'Kai Killian',
    headline: '~1.5 mi — Killian Dr / SW 112th',
    bio: 'Pinecrest coach along Killian for short-radius booking QA.',
    skill_rating: 4.0,
    rating_system: 'DUPR',
    rating_average: 4.7,
    rating_count: 18,
    experience_years: 7,
    location: 'Pinecrest, FL',
    approxMiles: 1.5,
    court: {
      name: 'Near-Me Fixture — Pinecrest Community Courts',
      address_line1: '12645 SW 112th St',
      city: 'Pinecrest',
      state: 'FL',
      postal_code: '33156',
      latitude: 25.6695,
      longitude: -80.3320,
    },
    lessonPrice: 60,
  },
  {
    emailLocal: 'coach.pinecrest.palmetto',
    fullName: 'Paloma Bay',
    headline: '~3 mi — Palmetto Bay / Coral Reef Park',
    bio: 'Just south of Pinecrest for 5–10 mile radius testing.',
    skill_rating: 4.5,
    rating_system: 'UTR-P',
    rating_average: 4.8,
    rating_count: 24,
    experience_years: 10,
    location: 'Palmetto Bay, FL',
    approxMiles: 3.0,
    court: {
      name: 'Near-Me Fixture — Coral Reef Park Courts',
      address_line1: '7895 SW 152nd St',
      city: 'Palmetto Bay',
      state: 'FL',
      postal_code: '33157',
      latitude: 25.6280,
      longitude: -80.3180,
    },
    lessonPrice: 65,
  },
  {
    emailLocal: 'coach.pinecrest.tropical',
    fullName: 'Talia Kendall',
    headline: '~5 mi — Tropical Park / Kendall',
    bio: 'Appears at radius ≥10 from Pinecrest; useful for radius filter QA.',
    skill_rating: 3.0,
    rating_system: 'self',
    rating_average: 4.3,
    rating_count: 8,
    experience_years: 4,
    location: 'Kendall, FL',
    approxMiles: 5.0,
    court: {
      name: 'Near-Me Fixture — Tropical Park Courts',
      address_line1: '7900 SW 40th St',
      city: 'Miami',
      state: 'FL',
      postal_code: '33155',
      latitude: 25.7345,
      longitude: -80.3120,
    },
    lessonPrice: 50,
  },
  {
    emailLocal: 'coach.pinecrest.miami',
    fullName: 'Mira Miami',
    headline: '~12 mi — Downtown Miami / Bayfront',
    bio: 'Outside a 10-mile Pinecrest radius; should appear at 25 mi.',
    skill_rating: 5.0,
    rating_system: 'DUPR',
    rating_average: 4.9,
    rating_count: 35,
    experience_years: 12,
    location: 'Miami, FL',
    approxMiles: 12.0,
    court: {
      name: 'Near-Me Fixture — Margaret Pace Park Courts',
      address_line1: '1745 N Bayshore Dr',
      city: 'Miami',
      state: 'FL',
      postal_code: '33132',
      latitude: 25.7905,
      longitude: -80.1865,
    },
    lessonPrice: 85,
  },
];

async function ensureCourt(spec, createdByUserId) {
  const existing = await CourtLocation.findOne({
    where: {
      name: spec.name,
      city: spec.city,
      state: spec.state,
      postal_code: spec.postal_code,
      deleted_at: null,
    },
  });
  if (existing) {
    await existing.update({
      address_line1: spec.address_line1,
      latitude: spec.latitude,
      longitude: spec.longitude,
      is_private: false,
    });
    return existing;
  }
  return CourtLocation.create({
    ...spec,
    country: 'US',
    is_private: false,
    source: 'manual',
    created_by_user_id: createdByUserId,
  });
}

async function ensureCoach(spec, passwordHash) {
  const email = `${spec.emailLocal}@${DOMAIN}`;
  let user = await User.findOne({ where: { email } });
  if (!user) {
    user = await User.create({
      full_name: spec.fullName,
      email,
      password_hash: passwordHash,
      phone: null,
      timezone: 'America/New_York',
      is_active: true,
      email_verified_at: new Date(),
    });
    await UserRole.create({ user_id: user.id, role: 'coach' });
  } else {
    await user.update({
      full_name: spec.fullName,
      is_active: true,
      deleted_at: null,
      email_verified_at: user.email_verified_at || new Date(),
    });
    if (!(await UserRole.findOne({ where: { user_id: user.id, role: 'coach' } }))) {
      await UserRole.create({ user_id: user.id, role: 'coach' });
    }
  }

  const seedAcct = `acct_pinecrest_${spec.emailLocal.replace(/\./g, '_')}`;
  const profilePayload = {
    headline: spec.headline,
    bio: spec.bio,
    experience_years: spec.experience_years,
    skill_rating: spec.skill_rating,
    rating_system: spec.rating_system,
    rating_average: spec.rating_average,
    rating_count: spec.rating_count,
    location: spec.location,
    coach_commission_percent: 92.0,
    deleted_at: null,
    stripe_account_id: seedAcct,
    stripe_ready: true,
    stripe_onboarding_completed_at: new Date(),
  };

  let profile = await CoachProfile.findOne({ where: { user_id: user.id } });
  if (!profile) {
    await CoachProfile.create({ user_id: user.id, ...profilePayload });
  } else {
    await profile.update(profilePayload);
  }

  const court = await ensureCourt(spec.court, user.id);
  await CoachCourtLocation.findOrCreate({
    where: { coach_id: user.id, court_id: court.id },
    defaults: { coach_notes: `Near Pinecrest (~${spec.approxMiles} mi)` },
  });

  let lesson = await Lesson.findOne({
    where: { coach_id: user.id, title: 'Pinecrest Near-Me Lesson', deleted_at: null },
  });
  if (!lesson) {
    lesson = await Lesson.create({
      coach_id: user.id,
      title: 'Pinecrest Near-Me Lesson',
      description: 'Marketplace lesson for Pinecrest near-me booking tests.',
      price: spec.lessonPrice,
      duration_minutes: 60,
      max_students: 1,
      is_active: true,
    });
  } else {
    await lesson.update({
      is_active: true,
      deleted_at: null,
      price: spec.lessonPrice,
      duration_minutes: 60,
    });
  }

  const availCount = await CoachAvailability.count({ where: { coach_id: user.id } });
  if (availCount === 0) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      await CoachAvailability.create({
        coach_id: user.id,
        weekday,
        start_time: '09:00:00',
        end_time: '17:00:00',
      });
    }
  }

  const eligibility = await getCoachMarketplaceEligibility(user.id);
  return {
    email,
    approxMiles: spec.approxMiles,
    court: spec.court.name,
    eligibility,
  };
}

async function main() {
  await sequelize.authenticate();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const results = [];
  for (const spec of COACHES) {
    results.push(await ensureCoach(spec, passwordHash));
  }

  console.log('\nSearch origin:');
  console.log(`  ${PINECREST_ORIGIN.label}`);
  console.log(`  lat=${PINECREST_ORIGIN.lat} lng=${PINECREST_ORIGIN.lng}`);
  console.log('\nSeeded Pinecrest near-me coaches (password Test1234!Ab):\n');
  for (const r of results) {
    const ok = r.eligibility?.listed
      ? 'marketplace-ready'
      : `NOT ready: ${(r.eligibility?.missing || []).join(', ') || 'unknown'}`;
    console.log(`  ${r.email}`);
    console.log(`    ~${r.approxMiles} mi · ${r.court} · ${ok}`);
  }
  console.log('\nDiscover QA:');
  console.log('  Search location: Pinecrest, FL  (or lat/lng above)');
  console.log('  radius 5  → Piper, Kai, Paloma, Talia');
  console.log('  radius 10 → same');
  console.log('  radius 25 → + Mira Miami\n');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌', err.message);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
